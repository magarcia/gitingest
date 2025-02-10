# Git Ingest ✨ 

Turn any Git repository into a simple text digest of its codebase.

This is useful for feeding a codebase into any LLM.

Inspired by [gitingest.com](https://gitingest.com/)

## Features

- Extracts text content from all files in a git repository
- Generates a tree structure of the repository
- Respects `.gitignore` rules
- Automatically detects and skips binary files
- Provides clear file separation in output
- Supports multiple repository input formats:
  - Local directory
  - Git URLs (HTTPS and SSH)
  - GitHub web URLs (with branch support)
  - GitLab web URLs (with branch support)
- Optional clipboard support
- Cross-platform support (Windows, macOS, Linux)
- Written in TypeScript with full type safety

## Requirements

- Node.js >= 12.0.0
- Git installed and available in PATH

## Installation

```bash
npm install -g @magarcia/gitingest
```

## Usage

Once installed, the tool can be executed as `git ingest`.

### Basic Usage

```bash
# Process current directory
git ingest

# Process specific local directory
git ingest /path/to/repo

# Copy output to clipboard instead of printing
git ingest -c
git ingest --copy
```

### Remote Repositories

The tool supports various repository URL formats:

```bash
# GitHub URLs
git ingest https://github.com/username/repo
git ingest https://github.com/username/repo/tree/branch

# GitLab URLs
git ingest https://gitlab.com/username/repo
git ingest https://gitlab.com/username/repo/-/tree/branch

# Direct Git URLs
git ingest git@github.com:username/repo.git
git ingest https://github.com/username/repo.git
```

When using a remote repository URL:
1. The repository is cloned to a temporary directory
2. Content is extracted
3. Temporary directory is automatically cleaned up

### Output Format

The tool generates two main sections:
1. Repository Tree Structure: A visual representation of the repository's file structure
2. Repository Content: The actual content of text files

Example output:
```
Repository Tree Structure:
├── src
│   ├── index.ts
│   └── utils.ts
├── package.json
└── README.md

Repository Content:
File: src/index.ts
[content...]

File: src/utils.ts
[content...]
```

## API

The package also exports functions that you can use in your own code:

```typescript
import { extractRepositoryContent } from '@magarcia/gitingest';

// Extract content from a local repository
const { content, tree } = extractRepositoryContent('/path/to/repo');
console.log('Tree structure:', tree);
console.log('Content:', content);
```

### Functions

#### `extractRepositoryContent(repoPath: string): { content: string, tree: string }`

Extracts text content and tree structure from a local git repository.

- `repoPath`: Path to the local git repository
- Returns an object with:
  - `content`: Concatenated text content from all files
  - `tree`: Visual tree structure of the repository

## Development

To contribute to this project, please follow these steps:

1.  Fork the repository.
2.  Create a new branch for your feature or bug fix.
3.  Make your changes.
4.  Submit a pull request.

### Prerequisites

- Node.js (v14 or later)
- npm or yarn

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Scripts

- `npm run build` - Builds the TypeScript code
- `npm run dev` - Runs the tool in development mode


## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

MIT
