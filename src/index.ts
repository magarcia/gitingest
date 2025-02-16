#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import ignore from 'ignore';
import glob from 'glob';
import os from 'os';
import crypto from 'crypto';
import { execSync } from 'child_process';
import clipboardy from 'clipboardy';
import { rimraf } from 'rimraf';

/**
 * Converts a GitHub or GitLab web URL to a git URL
 * @param url - The web URL to convert
 * @returns Object containing the git URL and optionally the branch
 */
function convertWebUrlToGitUrl(url: string): GitInfo {
    // GitHub web URL patterns
    const githubWebPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(\/tree\/([^/]+))?/;
    const githubRepoPattern = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/;
    
    // GitLab web URL patterns
    const gitlabWebPattern = /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)(\/-\/tree\/([^/]+))?/;
    const gitlabRepoPattern = /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)$/;

    let match;
    
    // Try matching GitHub patterns
    if ((match = url.match(githubWebPattern)) || (match = url.match(githubRepoPattern))) {
        const [, owner, repo, , branch] = match;
        const cleanRepo = repo.replace(/\.git$/, '');
        return {
            url: `https://github.com/${owner}/${cleanRepo}.git`,
            ...(branch && { branch })
        };
    }
    
    // Try matching GitLab patterns
    if ((match = url.match(gitlabWebPattern)) || (match = url.match(gitlabRepoPattern))) {
        const [, owner, repo, , branch] = match;
        const cleanRepo = repo.replace(/\.git$/, '');
        return {
            url: `https://gitlab.com/${owner}/${cleanRepo}.git`,
            ...(branch && { branch })
        };
    }
    
    // If no patterns match, return the original URL
    return { url };
}

/**
 * Checks if a string is a valid Git URL or web URL
 * @param url - The URL to check
 * @returns boolean indicating if it's a valid repository URL
 */
function isGitUrl(url: string): boolean {
    // Git URL patterns
    const patterns = [
        /^git@[^:]+:.+\.git$/,
        /^https:\/\/[^/]+\/.+\.git$/,
        /^https:\/\/github\.com\/[^/]+\/[^/]+(\/tree\/[^/]+)?$/,
        /^https:\/\/gitlab\.com\/[^/]+\/[^/]+(\/-\/tree\/[^/]+)?$/
    ];
    
    return patterns.some(pattern => pattern.test(url));
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
        // Read the first 512 bytes of the file
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);
        
        // Check for null bytes in the read portion
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) {
                return true;
            }
        }
        
        return false;
    } catch {
        // If there's any error reading the file, assume it's not binary
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
 * Generates a tree structure of the repository, respecting .gitignore rules and additional ignore patterns
 * 
 * @param repoPath - Path to the local git repository
 * @param additionalIgnorePatterns - Additional glob patterns to ignore
 * @returns The tree structure as a string
 */
function generateTreeStructure(repoPath: string, additionalIgnorePatterns: string[] = []): string {
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

        // Add additional ignore patterns if provided
        if (additionalIgnorePatterns.length > 0) {
            ignoreFilter.add(additionalIgnorePatterns);
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
 * @param additionalIgnorePatterns - Additional glob patterns to ignore
 * @returns Object containing repository content and tree structure
 */
function extractRepositoryContent(repoPath: string, additionalIgnorePatterns: string[] = []): { content: string, tree: string } {
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

    // Add additional ignore patterns if provided
    if (additionalIgnorePatterns.length > 0) {
        ignoreFilter.add(additionalIgnorePatterns);
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
        
        // Skip if file is ignored by .gitignore or additional patterns
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

    // Generate tree structure with the same ignore patterns
    const tree = generateTreeStructure(repoPath, additionalIgnorePatterns);

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
        rimraf.sync(dir);
    } catch (error) {
        console.error(`Warning: Failed to remove temporary directory ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Export functions for testing
export { convertWebUrlToGitUrl, isGitUrl };

// Help text for the CLI
const helpText = `
Git Ingest - Extract and analyze content from Git repositories

Usage:
  git-ingest [options] [repository]

Arguments:
  repository            Path to local repository or Git URL (default: current directory)

Options:
  --help               Show this help message
  --copy, -c          Copy the output to clipboard
  --ignore <pattern>   Ignore files/directories matching the glob pattern
                      (can be used multiple times)

Examples:
  # Analyze current directory
  git-ingest

  # Analyze local repository
  git-ingest /path/to/repo

  # Analyze remote repository
  git-ingest https://github.com/user/repo

  # Ignore specific files
  git-ingest --ignore "*.log" --ignore "temp/*"

  # Copy output to clipboard
  git-ingest /path/to/repo --copy
`;

// If running as a script
if (require.main === module) {
    const args = process.argv.slice(2);
    
    // Show help if requested
    if (args.includes('--help')) {
        console.log(helpText);
        process.exit(0);
    }

    // Extract ignore patterns
    const ignorePatterns: string[] = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--ignore') {
            if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                ignorePatterns.push(args[i + 1]);
                i++; // Skip the next argument since we've used it
            }
        }
    }
    
    // Filter out the --ignore and their values from args
    const filteredArgs = args.filter((arg, index) => {
        if (arg === '--ignore') {
            return false;
        }
        if (index > 0 && args[index - 1] === '--ignore') {
            return false;
        }
        return true;
    });
    
    const repoPath = filteredArgs.find(arg => !arg.startsWith('-')) || process.cwd();
    let tempDir: string | null = null;

    try {
        let targetPath = repoPath;

        // If it's a git URL or web URL, clone it to a temporary directory
        if (isGitUrl(repoPath)) {
            const gitInfo = convertWebUrlToGitUrl(repoPath);
            tempDir = createTempDir();
            console.log('Cloning repository...');
            cloneRepository(gitInfo, tempDir);
            targetPath = tempDir;
        }

        // Extract content with additional ignore patterns
        const { content, tree } = extractRepositoryContent(targetPath, ignorePatterns);
        const output = `Repository Tree Structure:\n${tree}\n\nRepository Content:\n${content}`;

        const shouldCopy = filteredArgs.includes('--copy') || filteredArgs.includes('-c');
        if (shouldCopy) {
            clipboardy.writeSync(output);
            console.log('Content has been copied to clipboard!');
        } else {
            console.log(output);
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    } finally {
        // Clean up temporary directory if it was created
        if (tempDir) {
            removeTempDir(tempDir);
        }
    }
}

interface GitInfo {
    url: string;
    branch?: string;
}
