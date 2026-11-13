const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const packageRoot = process.env.GITINGEST_PACKAGE_ROOT || path.resolve(__dirname, '..');
const entry = path.join(packageRoot, 'dist', 'index.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitingest-runtime-'));
const repo = path.join(root, 'fixture.git');
const temp = path.join(root, 'temp');
const external = path.join(root, 'external.txt');

function run(args) {
    return spawnSync(process.execPath, [entry, ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
            ...process.env,
            TMPDIR: temp,
            TMP: temp,
            TEMP: temp,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: process.platform === 'win32' ? '\\\\.\\nul' : '/dev/null',
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: `url.${pathToFileURL(root).href}/.insteadOf`,
            GIT_CONFIG_VALUE_0: 'https://runtime.invalid/',
            GIT_TERMINAL_PROMPT: '0',
        },
    });
}

try {
    fs.mkdirSync(repo);
    fs.mkdirSync(temp);
    fs.mkdirSync(path.join(repo, 'nested'));
    fs.writeFileSync(path.join(repo, 'nested', 'keep.txt'), 'included content');
    fs.writeFileSync(path.join(repo, 'skip.log'), 'ignored content');
    fs.writeFileSync(path.join(repo, '.gitignore'), '*.log\n');
    fs.writeFileSync(path.join(repo, 'binary.dat'), Buffer.from([0, 1, 2]));
    fs.writeFileSync(external, 'external target');
    if (process.platform !== 'win32') {
        fs.symlinkSync(external, path.join(repo, 'linked.txt'));
    }
    execFileSync('git', ['init', '--quiet', repo]);
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Runtime Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']);

    const help = run(['--help']);
    assert.strictEqual(help.status, 0, help.stderr);
    assert(help.stdout.includes('Usage:'));

    const local = run([repo]);
    assert.strictEqual(local.status, 0, local.stderr);
    assert(local.stdout.includes('included content'));
    assert(!local.stdout.includes('ignored content'));
    assert(!local.stdout.includes('File: binary.dat'));
    assert(!local.stdout.includes('File: .git/'));

    const ignored = run([repo, '--ignore', 'nested/**']);
    assert.strictEqual(ignored.status, 0, ignored.stderr);
    assert(!ignored.stdout.includes('included content'));

    const cloned = run(['https://runtime.invalid/fixture.git']);
    assert.strictEqual(cloned.status, 0, cloned.stderr);
    assert(cloned.stdout.includes('Cloning repository...'));
    assert(cloned.stdout.includes('included content'));
    assert(!cloned.stderr.includes('Failed to remove temporary directory'), cloned.stderr);
    assert.deepStrictEqual(fs.readdirSync(temp), []);
    assert.strictEqual(fs.readFileSync(external, 'utf8'), 'external target');

    const failed = run(['https://runtime.invalid/missing.git']);
    assert.strictEqual(failed.status, 1, failed.stderr);
    assert(failed.stderr.includes('Failed to clone repository'));
    assert(!failed.stderr.includes('Failed to remove temporary directory'), failed.stderr);
    assert.deepStrictEqual(fs.readdirSync(temp), []);

    for (const mode of ['commonjs', 'module']) {
        const load = mode === 'commonjs'
            ? `const api = require(${JSON.stringify(entry)});`
            : `import * as api from ${JSON.stringify(pathToFileURL(entry).href)};`;
        const imported = spawnSync(process.execPath, [
            `--input-type=${mode}`,
            '-e',
            `${load}
            if (!api.isGitUrl('https://github.com/owner/repo')) process.exit(1);
            if (api.isGitUrl('/local/repo')) process.exit(1);
            const converted = api.convertWebUrlToGitUrl('https://github.com/owner/repo/tree/main');
            if (converted.url !== 'https://github.com/owner/repo.git' || converted.branch !== 'main') process.exit(1);`,
        ], { encoding: 'utf8', timeout: 10000 });
        assert.strictEqual(imported.status, 0, imported.stderr);
        assert.strictEqual(imported.stdout, '');
        assert.strictEqual(imported.stderr, '');
    }

    console.log('Passed CLI, clone cleanup, failure cleanup, symlink safety, and CommonJS/ESM export checks.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
