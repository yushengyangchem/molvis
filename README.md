# molvis

A minimal viewer for ORCA output (`.out`) files.

- Rust backend reads and parses ORCA text into `energy + coordinates` JSON
- JavaScript frontend uses `3Dmol.js` to render molecular structures and switch frames with a slider

## Install

From crates.io (published package):

```bash
cargo install molvis
```

From local source (not published yet):

```bash
cargo install --path .
```

## Installed binary run

```bash
molvis /path/to/your.out
molvis -H 0.0.0.0 -p 8080 /path/to/your.out
```

## Develop (run from source)

```bash
cargo run -- /path/to/your.out
```

Open `http://127.0.0.1:3000`

```bash
cargo run -- -H 0.0.0.0 -p 8080 /path/to/your.out
```
