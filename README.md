# molvis

A minimal web viewer for molecular trajectory/output text.

- Rust backend reads and parses output text into `energy + coordinates` JSON
- JavaScript frontend uses `3Dmol.js` to render molecular structures and switch frames with a slider

Current parser support: ORCA `.out` only.
Future formats (for example Gaussian / XYZ batches) can be added later.

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

## Frontend JS loading

The frontend loads two browser libraries:

- `3Dmol-min.js` for 3D molecular rendering
- `plotly.min.js` for interactive energy trend chart

Default behavior: `local first, CDN fallback`.

- If `web/3Dmol-min.js` / `web/plotly.min.js` exist, local files are used.
- If local files are absent, it automatically falls back to CDN.

Optional offline mode: place these files under `web/` and they will be used first:

- `web/3Dmol-min.js`
- `web/plotly.min.js`

You can fetch them with:

```bash
scripts/fetch-web-libs.sh
```

Use `--force` to re-download:

```bash
scripts/fetch-web-libs.sh --force
```

### Note for intranet / no-internet environments

- If external CDN access is blocked, 3D viewer or trend chart may fail to load.
- In that case, provide local files under `web/` (recommended), or allowlist the CDN domains in your network policy.
- If only one library fails to load, the other feature can still work (for example, 3D works but chart fails, or vice versa).
