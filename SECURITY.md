# Security policy

## Reporting a problem

Please report security problems privately: on this repository, **Security → Report a vulnerability**. Don't open a
public issue for them.

Reports are read and answered as soon as possible. Fixes go live with the next deploy, and the advisory is published
once they have.

## Scope

- **In scope:** the code in this repository and the live site it deploys, [tierinator.sayel.dev](https://tierinator.sayel.dev).
- **Out of scope:** the third-party sites the app fetches from (report those to them), and anything that needs an
  already compromised browser or device.

## What protects the site

The site has no server, accounts or database, so most of the usual web-app attacks have nothing to aim at. What's left
(hostile files and links, injected markup, the build and deploy pipeline) is covered in
[docs/security.md](docs/security.md), item by item.
