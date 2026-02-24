# molvis

A minimal framework for visualizing ORCA output (`.out`) files:

- Rust backend reads and parses ORCA text into `energy + coordinates` JSON
- JavaScript frontend uses 3Dmol.js to render molecular structures and switch frames with a slider

## Quick Start

```bash
cargo run -- /path/to/your.out
```

Open `http://127.0.0.1:3000`

At startup, the backend reads and parses the ORCA output file from CLI input.

Optional server binding arguments:

```bash
cargo run -- -H 0.0.0.0 -p 8080 /path/to/your.out
```

Defaults:

- `-H` / `--host`: `127.0.0.1`
- `-p` / `--port`: `3000`

## Install

```bash
cargo install molvis
molvis /path/to/your.out
```

## Current API

- `GET /api/data`: returns the parsed frames/energy from the CLI-provided file

## Project Structure

```text
src/
  main.rs      # API + static file serving
  parser.rs    # ORCA text parsing logic
  models.rs    # data structures
web/
  index.html
  app.js
  style.css
```

## Suggested Next Steps

1. Expand parser rules for different ORCA task types (optimization trajectory, frequency, scan, etc.)
2. Add an energy curve on the frontend (`x=step`, `y=E`)
3. Replace path-based reading with file upload endpoints (avoid unrestricted server-side file reads)
