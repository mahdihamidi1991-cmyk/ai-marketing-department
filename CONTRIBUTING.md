# Contributing

Open an issue describing the problem, expected behavior and steps to reproduce. Use synthetic data and redact keys, account IDs and private business information.

For changes, fork the repository and open a focused pull request. Explain the user-facing behavior, how it was checked and any limitations. Preserve English default UI text, multilingual input, explicit Demo/Live separation and accurate claims about external actions.

Run the Python and Node test commands in the README. Tests must not require an API key or paid provider calls. Add targeted coverage when changing routing validation, authentication, persistence or concurrency. Visual changes should include desktop and mobile screenshots with synthetic data.

Do not commit `.env`, `.remote.env`, tunnel tokens, local databases, provider responses containing private data, or downloaded binaries. Keep runtime dependencies minimal. Proposed connectors, scheduling and external actions need a design discussion before implementation.
