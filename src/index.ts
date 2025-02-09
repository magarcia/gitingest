#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import glob from 'glob';
import clipboardy from 'clipboardy';
import { execSync } from 'child_process';
import os from 'os';
import crypto from 'crypto';
import {rimrafSync} from 'rimraf';

interface GitInfo {
    url: string;
    branch?: string;
}

/**
 * Converts a GitHub or GitLab web URL to a git URL
 * @param url - The web URL to convert
 * @returns Object containing the git URL and optionally the branch
 */
function convertWebUrlToGitUrl(url: string): GitInfo {
    // Remove trailing slash if present
    url = url.replace(/\/$/, '');

    // GitHub URL patterns
    const githubPatterns = [
        // GitHub web URL with branch/tree
        /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/(?:tree|blob)\/([^\/]+)(?:\/.*)?$/,
        // GitHub web URL without branch
        /^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/?$/
    ];

    // GitLab URL patterns
    const gitlabPatterns = [
        // GitLab web URL with branch/tree
        /^https?:\/\/gitlab\.com\/([^\/]+)\/([^\/]+)\/(?:-\/tree|blob)\/([^\/]+)(?:\/.*)?$/,
        // GitLab web URL without branch
        /^https?:\/\/gitlab\.com\/([^\/]+)\/([^\/]+)\/?$/
    ];

    // Check GitHub patterns
    for (const pattern of githubPatterns) {
        const match = url.match(pattern);
        if (match) {
            const [, owner, repo, branch] = match;
            return {
                url: `https://github.com/${owner}/${repo}.git`,
                branch: branch
            };
        }
    }

    // Check GitLab patterns
    for (const pattern of gitlabPatterns) {
        const match = url.match(pattern);
        if (match) {
            const [, owner, repo, branch] = match;
            return {
                url: `https://gitlab.com/${owner}/${repo}.git`,
                branch: branch
            };
        }
    }

    // If it's already a git URL, return as is
    if (isGitUrl(url)) {
        return { url };
    }

    throw new Error('Invalid repository URL');
}

/**
 * Checks if a string is a valid Git URL or web URL
 * @param url - The URL to check
 * @returns boolean indicating if it's a valid repository URL
 */
function isGitUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
        return false;
    }

    // Direct git URL patterns
    const gitUrlPattern = /^(git|https?):\/\/(?:github|gitlab)\.com/i;
    if (gitUrlPattern.test(url) || url.startsWith('git@')) {
        return true;
    }

    // GitHub and GitLab web URL patterns
    const webUrlPattern = /^https?:\/\/(?:github|gitlab)\.com\/[^\/]+\/[^\/]+(?:\/(?:(?:tree|blob)|(?:-\/(?:tree|blob)))\/[^\/]+)?(?:\/.*)?$/;
    return webUrlPattern.test(url);
}

/**
 * Checks if a file is likely to be binary by examining its contents.
 * Uses a heuristic approach by checking for null bytes in the first portion of the file.
 *
 * @param filePath - The path to the file to check
 * @returns True if the file is likely binary, false otherwise
 */
function isBinaryFile(filePath: string): boolean {
    try {
        // Read the first 24 bytes of the file as a buffer
        const buffer = fs.readFileSync(filePath, { encoding: null, flag: 'r' });

        // Check for null bytes in the first 24 bytes
        // This is a simple heuristic - binary files often contain null bytes
        for (let i = 0; i < Math.min(24, buffer.length); i++) {
            if (buffer[i] === 0) {
                return true; // Found a null byte, likely binary
            }
        }
        return false; // No null bytes found, likely text
    } catch (e) {
        // If we can't read the file, assume it's not binary
        return false;
    }
}

/**
 * Recursively lists files and directories in a tree-like structure
 * 
 * @param dir - Directory to traverse
 * @param prefix - Prefix for the current line (used for recursion)
 * @param ignoreFilter - Ignore filter for files/directories
 * @returns Array of strings representing the tree structure
 */
function listDirectoryTree(dir: string, prefix: string = '', ignoreFilter: ReturnType<typeof ignore>): string[] {
    const entries: string[] = [];
    const items = fs.readdirSync(dir);
    
    // Filter ignored items first
    const visibleItems = items.filter(item => {
        const itemPath = path.join(dir, item);
        const relativePath = path.relative(process.cwd(), itemPath);
        return !ignoreFilter.ignores(relativePath);
    });
    
    visibleItems.sort((a, b) => {
        // Directories first, then files
        const aStats = fs.statSync(path.join(dir, a));
        const bStats = fs.statSync(path.join(dir, b));
        if (aStats.isDirectory() && !bStats.isDirectory()) return -1;
        if (!aStats.isDirectory() && bStats.isDirectory()) return 1;
        return a.localeCompare(b, undefined, { sensitivity: 'base' }); // Cross-platform case-insensitive sort
    });

    visibleItems.forEach((item, index) => {
        const itemPath = path.join(dir, item);
        const isLast = index === visibleItems.length - 1;
        const stats = fs.statSync(itemPath);
        
        // Use cross-platform compatible characters for tree structure
        const marker = isLast ? '└── ' : '├── ';
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        
        entries.push(prefix + marker + item);
        
        if (stats.isDirectory()) {
            entries.push(...listDirectoryTree(itemPath, newPrefix, ignoreFilter));
        }
    });
    
    return entries;
}

/**
 * Generates a tree structure of the repository, respecting .gitignore rules
 * 
 * @param repoPath - Path to the local git repository
 * @returns The tree structure as a string
 */
function generateTreeStructure(repoPath: string): string {
    try {
        const gitignorePath = path.join(repoPath, '.gitignore');
        const ignoreFilter = ignore();
        
        // Always ignore .git directory
        ignoreFilter.add(['.git']);

        // Load .gitignore if it exists
        if (fs.existsSync(gitignorePath)) {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
            ignoreFilter.add(gitignoreContent);
        }

        // Change to the repository directory to get correct relative paths
        const originalCwd = process.cwd();
        process.chdir(repoPath);

        try {
            const tree = listDirectoryTree(repoPath, '', ignoreFilter);
            return tree.join('\n') + '\n';
        } finally {
            // Always restore the original working directory
            process.chdir(originalCwd);
        }
    } catch (error) {
        console.error('Error generating tree structure:', error instanceof Error ? error.message : String(error));
        return '';
    }
}

/**
 * Extracts text content from a local git repository, respecting .gitignore rules.
 * Skips binary files and handles errors gracefully.
 * 
 * @param repoPath - Path to the local git repository
 * @returns Object containing repository content and tree structure
 */
export function extractRepositoryContent(repoPath: string): { content: string, tree: string } {
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    // Initialize gitignore filter
    const gitignorePath = path.join(repoPath, '.gitignore');
    const ignoreFilter = ignore();
    
    // Always ignore .git directory
    ignoreFilter.add(['.git/**']);

    // Load .gitignore if it exists
    if (fs.existsSync(gitignorePath)) {
        const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
        ignoreFilter.add(gitignoreContent);
    }

    // Find all files in the repository
    const files = glob.sync('**/*', {
        cwd: repoPath,
        dot: true,
        nodir: true,
        absolute: true,
    });

    // Process each file
    const contentParts: string[] = [];
    files.forEach(file => {
        const relativePath = path.relative(repoPath, file);
        
        // Skip if file is ignored by .gitignore
        if (ignoreFilter.ignores(relativePath)) {
            return;
        }

        try {
            // Skip binary files
            if (isBinaryFile(file)) {
                return;
            }

            // Read and process text files
            const content = fs.readFileSync(file, 'utf-8');
            contentParts.push(`File: ${relativePath}\n${content}\n`);
        } catch (error) {
            console.error(`Error processing file ${file}:`, error instanceof Error ? error.message : String(error));
        }
    });

    // Generate tree structure
    const tree = generateTreeStructure(repoPath);

    return {
        content: contentParts.join('\n'),
        tree
    };
}

/**
 * Creates a temporary directory for cloning the repository
 * @returns Path to the temporary directory
 */
function createTempDir(): string {
    const tmpDir = path.join(os.tmpdir(), `git-ingest-${crypto.randomBytes(6).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
}

/**
 * Clones a git repository to a specified directory
 * @param gitInfo - Object containing git URL and optional branch
 * @param targetDir - Directory to clone into
 */
function cloneRepository(gitInfo: GitInfo, targetDir: string): void {
    try {
        // Ensure paths are properly escaped for all platforms
        const safeTargetDir = targetDir.replace(/"/g, '\\"');
        let command = `git clone "${gitInfo.url}" "${safeTargetDir}"`;
        if (gitInfo.branch) {
            command += ` --branch ${gitInfo.branch}`;
        }
        execSync(command, { 
            stdio: 'pipe',
            windowsHide: true // Prevent command prompt from showing on Windows
        });
    } catch (error) {
        throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Removes a directory and its contents recursively
 * @param dir - Directory to remove
 */
function removeTempDir(dir: string): void {
    try {
        // Use rimraf for cross-platform directory removal
        rimrafSync(dir);
    } catch (error) {
        console.error(`Warning: Failed to remove temporary directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Export functions for testing
export { convertWebUrlToGitUrl, isGitUrl };

// If running as a script
if (require.main === module) {
    const args = process.argv.slice(2);
    const shouldCopy = args.includes('--copy') || args.includes('-c');
    let repoPath = args.find(arg => !arg.startsWith('-')) || process.cwd();

    try {
        let targetPath = repoPath;
        let tempDir: string | null = null;

        // If it's a git URL or web URL, clone it to a temporary directory
        if (isGitUrl(repoPath)) {
            const gitInfo = convertWebUrlToGitUrl(repoPath);
            tempDir = createTempDir();
            console.log('Cloning repository...');
            cloneRepository(gitInfo, tempDir);
            targetPath = tempDir;
        }

        try {
            const { content, tree } = extractRepositoryContent(targetPath);
            const output = `Repository Tree Structure:\n${tree}\n\nRepository Content:\n${content}`;

            if (shouldCopy) {
                clipboardy.writeSync(output);
                console.log('Content has been copied to clipboard!');
            } else {
                console.log(output);
            }
        } finally {
            // Clean up temporary directory if it was created
            if (tempDir) {
                removeTempDir(tempDir);
            }
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
