# Contributing

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs and ideas:** open an issue first for anything bigger than a small fix, so the approach is agreed before you
  spend time on it.
- **Security problems:** report them privately (see [SECURITY.md](SECURITY.md)), never as an issue.

## Setting up

```sh
pnpm install
pnpm exec playwright install chromium   # once, for the browser tests
pnpm dev
```

## Making a change

1. Read [docs/architecture.md](docs/architecture.md). The rules between folders and the shape of a file are short, and
   following them keeps reviews quick.
2. Keep a pull request to one thing.
3. Add or update tests: unit tests for parsing and maths, a browser test for anything you can click.
4. Run `pnpm format` and `pnpm verify`, and `pnpm test:e2e` if you can (CI runs it either way).
5. Say what changed and how you checked it.

## House rules

- Markup only through `` html`…` `` and `setHtml`. No `innerHTML`, no inline `onclick=`.
- Anything from outside (files, links, websites) is checked before it's used.
- New dependencies need a good reason; a few dozen readable lines of our own usually win.
- Old list files must keep opening. If you touch the saved format, add a test with an old file.
- British spelling in the interface (`colour`, `favourite`), sentence case, plain words.

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE).
