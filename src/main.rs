mod models;
mod parser;

use axum::{
    extract::State,
    http::header,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use clap::builder::styling::{AnsiColor, Effects, Styles};
use clap::parser::ValueSource;
use clap::{CommandFactory, FromArgMatches, Parser, ValueEnum};
use serde_json::to_vec;
use std::{
    env, fs as stdfs,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    process,
    sync::Arc,
};
use tokio::fs;

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const BASE_CSS: &str = include_str!("../web/styles/base.css");
const LAYOUT_CSS: &str = include_str!("../web/styles/layout.css");
const PANELS_CSS: &str = include_str!("../web/styles/panels.css");
const CHART_CSS: &str = include_str!("../web/styles/chart.css");
const VIEWER_CSS: &str = include_str!("../web/styles/viewer.css");
const CPK_COLORS_JS: &str = include_str!("../web/cpkColors.js");
const GEOMETRY_JS: &str = include_str!("../web/modules/geometry.js");
const MEASUREMENT_JS: &str = include_str!("../web/modules/measurement.js");
const MOL_BUILDER_JS: &str = include_str!("../web/modules/molBuilder.js");
const EXPORT_PANEL_JS: &str = include_str!("../web/modules/exportPanel.js");
const FREQUENCY_PANEL_JS: &str = include_str!("../web/modules/frequencyPanel.js");
const THERMOCHEMISTRY_JS: &str = include_str!("../web/modules/thermochemistry.js");
const TREND_CHART_JS: &str = include_str!("../web/modules/trendChart.js");
const VIBRATION_JS: &str = include_str!("../web/modules/vibration.js");
const VIEWER_FRAME_JS: &str = include_str!("../web/modules/viewerFrame.js");
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
struct AppState {
    parsed_json: Arc<Vec<u8>>,
}

#[derive(Debug)]
struct CliConfig {
    out_path: String,
    host: IpAddr,
    port: u16,
}

#[derive(Debug)]
enum CliAction {
    Run(CliConfig),
    ExportLastXyz {
        out_path: String,
        output_name: Option<String>,
    },
    InitConfig,
}

#[derive(Debug, Default)]
struct FileConfig {
    host: Option<IpAddr>,
    port: Option<u16>,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliThemeArg {
    Auto,
    Dark,
    Light,
}

#[derive(Debug, Parser)]
#[command(
    name = "molvis",
    version,
    about = "Molecular trajectory viewer (currently ORCA .out)",
    long_about = "CLI web viewer for molecular trajectories with 3Dmol.js rendering. Current parser support: ORCA .out.",
    arg_required_else_help = true,
    next_line_help = true,
    help_template = "\
{before-help}{name} {version}
{about-with-newline}
{usage-heading} {usage}

{all-args}{after-help}",
    after_help = "Examples:\n  molvis path/to/file.out\n  molvis -H 0.0.0.0 -p 8080 path/to/file.out\n  molvis --xyz path/to/file.out\n  molvis -x -n job_opt path/to/file.out"
)]
struct CliArgs {
    #[arg(
        value_name = "PATH",
        required_unless_present = "init_config",
        help = "Path to molecular output file (currently ORCA .out)"
    )]
    out_path: Option<String>,
    #[arg(
        short = 'x',
        long = "xyz",
        help = "Write the last parsed geometry to an XYZ file and exit"
    )]
    export_last_xyz: bool,
    #[arg(
        short = 'n',
        long = "name",
        allow_hyphen_values = true,
        value_name = "NAME",
        help = "Append a suffix to the input file stem for the output XYZ name"
    )]
    output_name: Option<String>,
    #[arg(
        short = 'H',
        long = "host",
        value_name = "IP",
        default_value = "127.0.0.1",
        help = "Bind host"
    )]
    host: IpAddr,
    #[arg(
        short = 'p',
        long = "port",
        value_name = "PORT",
        default_value_t = 3000,
        help = "Bind port"
    )]
    port: u16,
    #[arg(
        long = "term-theme",
        value_enum,
        default_value_t = CliThemeArg::Auto,
        help = "CLI help color theme: auto | dark | light"
    )]
    term_theme: CliThemeArg,
    #[arg(
        long = "init-config",
        help = "Initialize ~/.config/molvis/config.toml and exit"
    )]
    init_config: bool,
}

#[derive(Debug, Clone, Copy)]
enum CliTheme {
    Dark,
    Light,
}

fn cli_styles_dark() -> Styles {
    Styles::styled()
        .header(AnsiColor::Cyan.on_default() | Effects::BOLD)
        .usage(AnsiColor::Cyan.on_default() | Effects::BOLD)
        .literal(AnsiColor::Green.on_default() | Effects::BOLD)
        .placeholder(AnsiColor::Yellow.on_default())
        .valid(AnsiColor::Green.on_default())
        .invalid(AnsiColor::Red.on_default() | Effects::BOLD)
        .error(AnsiColor::Red.on_default() | Effects::BOLD)
}

fn cli_styles_light() -> Styles {
    Styles::styled()
        .header(AnsiColor::Blue.on_default() | Effects::BOLD)
        .usage(AnsiColor::Blue.on_default() | Effects::BOLD)
        .literal(AnsiColor::Magenta.on_default() | Effects::BOLD)
        .placeholder(AnsiColor::Blue.on_default())
        .valid(AnsiColor::Green.on_default() | Effects::BOLD)
        .invalid(AnsiColor::Red.on_default() | Effects::BOLD)
        .error(AnsiColor::Red.on_default() | Effects::BOLD)
}

fn detect_terminal_theme() -> CliTheme {
    // Typical format: "<fg>;<bg>" or "<fg>;<bg>;<...>".
    if let Ok(v) = env::var("COLORFGBG") {
        if let Some(bg) = v
            .split(';')
            .filter_map(|token| token.parse::<u8>().ok())
            .next_back()
        {
            if (7..=15).contains(&bg) {
                return CliTheme::Light;
            }
            if bg <= 6 {
                return CliTheme::Dark;
            }
        }
    }
    CliTheme::Dark
}

fn resolve_cli_theme(theme_arg: CliThemeArg) -> CliTheme {
    match theme_arg {
        CliThemeArg::Auto => detect_terminal_theme(),
        CliThemeArg::Dark => CliTheme::Dark,
        CliThemeArg::Light => CliTheme::Light,
    }
}

fn styles_for_theme(theme: CliTheme) -> Styles {
    match theme {
        CliTheme::Dark => cli_styles_dark(),
        CliTheme::Light => cli_styles_light(),
    }
}

fn parse_theme_arg_from_raw_args() -> CliThemeArg {
    let mut args = env::args_os().skip(1);
    while let Some(arg) = args.next() {
        let s = arg.to_string_lossy();
        if let Some(v) = s.strip_prefix("--term-theme=") {
            return match v {
                "dark" => CliThemeArg::Dark,
                "light" => CliThemeArg::Light,
                _ => CliThemeArg::Auto,
            };
        }
        if s == "--term-theme" {
            if let Some(next) = args.next() {
                return match next.to_string_lossy().as_ref() {
                    "dark" => CliThemeArg::Dark,
                    "light" => CliThemeArg::Light,
                    _ => CliThemeArg::Auto,
                };
            }
            return CliThemeArg::Auto;
        }
    }
    CliThemeArg::Auto
}

#[tokio::main]
async fn main() {
    let action = parse_cli_args();
    match action {
        CliAction::InitConfig => {
            if let Err(err) = init_user_config() {
                eprintln!("Failed to initialize config: {err}");
                process::exit(1);
            }
            return;
        }
        CliAction::ExportLastXyz {
            out_path,
            output_name,
        } => {
            export_last_xyz(&out_path, output_name.as_deref()).await;
            return;
        }
        CliAction::Run(cli) => run_server(cli).await,
    }
}

async fn run_server(cli: CliConfig) {
    let content = match fs::read_to_string(&cli.out_path).await {
        Ok(content) => content,
        Err(err) => {
            eprintln!("Failed to read input file '{}': {err}", cli.out_path);
            process::exit(1);
        }
    };
    let parsed_data = parser::parse_orca_out(&cli.out_path, &content);
    let parsed_json = match to_vec(&parsed_data) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("Failed to serialize parsed data as JSON: {err}");
            process::exit(1);
        }
    };
    let frame_count = parsed_data.frames.len();

    let app_state = AppState {
        parsed_json: Arc::new(parsed_json),
    };

    let app = Router::new()
        .route("/", get(index_html))
        .route("/index.html", get(index_html))
        .route("/app.js", get(app_js))
        .route("/styles/base.css", get(base_css))
        .route("/styles/layout.css", get(layout_css))
        .route("/styles/panels.css", get(panels_css))
        .route("/styles/chart.css", get(chart_css))
        .route("/styles/viewer.css", get(viewer_css))
        .route("/cpkColors.js", get(cpk_colors_js))
        .route("/modules/geometry.js", get(geometry_js))
        .route("/modules/measurement.js", get(measurement_js))
        .route("/modules/molBuilder.js", get(mol_builder_js))
        .route("/modules/exportPanel.js", get(export_panel_js))
        .route("/modules/frequencyPanel.js", get(frequency_panel_js))
        .route("/modules/thermochemistry.js", get(thermochemistry_js))
        .route("/modules/trendChart.js", get(trend_chart_js))
        .route("/modules/vibration.js", get(vibration_js))
        .route("/modules/viewerFrame.js", get(viewer_frame_js))
        .route("/3Dmol-min.js", get(local_3dmol_js))
        .route("/plotly.min.js", get(local_plotly_js))
        .route("/api/data", get(get_parsed_data))
        .with_state(app_state);

    let addr = SocketAddr::new(cli.host, cli.port);
    println!("Parsed {frame_count} frame(s) from {}", cli.out_path);
    println!("Server running at http://{addr}");

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("Failed to bind server on {addr}: {err}");
            process::exit(1);
        }
    };
    if let Err(err) = axum::serve(listener, app).await {
        eprintln!("Server error: {err}");
        process::exit(1);
    }
}

async fn export_last_xyz(out_path: &str, output_name: Option<&str>) {
    let content = match fs::read_to_string(out_path).await {
        Ok(content) => content,
        Err(err) => {
            eprintln!("Failed to read input file '{}': {err}", out_path);
            process::exit(1);
        }
    };

    let parsed = parser::parse_orca_out(out_path, &content);
    let Some(last_frame) = parsed.frames.last() else {
        eprintln!(
            "Failed to export XYZ: no coordinate frames were parsed from '{}'",
            out_path
        );
        process::exit(1);
    };

    let output_path = build_xyz_output_path(out_path, output_name);
    let xyz = format_frame_as_xyz(last_frame);

    if let Err(err) = fs::write(&output_path, xyz).await {
        eprintln!(
            "Failed to write XYZ file '{}': {err}",
            output_path.display()
        );
        process::exit(1);
    }

    println!(
        "Exported last frame ({} atoms) to {}",
        last_frame.atoms.len(),
        output_path.display()
    );
}

fn build_xyz_output_path(out_path: &str, output_name: Option<&str>) -> PathBuf {
    let input_path = PathBuf::from(out_path);
    let parent = input_path.parent().map(PathBuf::from).unwrap_or_default();
    let stem = input_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("output");
    let suffix = output_name
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim())
        .unwrap_or("");

    parent.join(format!("{stem}{suffix}.xyz"))
}

fn format_frame_as_xyz(frame: &models::Frame) -> String {
    let mut text = String::new();
    text.push_str(&format!("{}\n", frame.atoms.len()));
    match frame.energy_hartree {
        Some(energy) => text.push_str(&format!(
            "step={} energy_hartree={energy:.10}\n",
            frame.step
        )),
        None => text.push_str(&format!("step={}\n", frame.step)),
    }

    for atom in &frame.atoms {
        text.push_str(&format!(
            "{:<2} {:>14.8} {:>14.8} {:>14.8}\n",
            atom.element, atom.x, atom.y, atom.z
        ));
    }

    text
}

async fn get_parsed_data(State(state): State<AppState>) -> Response {
    (
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        (*state.parsed_json).clone(),
    )
        .into_response()
}

async fn index_html() -> Response {
    let body = INDEX_HTML.replace("__MOLVIS_VERSION__", APP_VERSION);
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response()
}

async fn app_js() -> Response {
    static_response("text/javascript; charset=utf-8", APP_JS)
}

async fn base_css() -> Response {
    static_response("text/css; charset=utf-8", BASE_CSS)
}

async fn layout_css() -> Response {
    static_response("text/css; charset=utf-8", LAYOUT_CSS)
}

async fn panels_css() -> Response {
    static_response("text/css; charset=utf-8", PANELS_CSS)
}

async fn chart_css() -> Response {
    static_response("text/css; charset=utf-8", CHART_CSS)
}

async fn viewer_css() -> Response {
    static_response("text/css; charset=utf-8", VIEWER_CSS)
}

async fn cpk_colors_js() -> Response {
    static_response("text/javascript; charset=utf-8", CPK_COLORS_JS)
}

async fn geometry_js() -> Response {
    static_response("text/javascript; charset=utf-8", GEOMETRY_JS)
}

async fn measurement_js() -> Response {
    static_response("text/javascript; charset=utf-8", MEASUREMENT_JS)
}

async fn mol_builder_js() -> Response {
    static_response("text/javascript; charset=utf-8", MOL_BUILDER_JS)
}

async fn export_panel_js() -> Response {
    static_response("text/javascript; charset=utf-8", EXPORT_PANEL_JS)
}

async fn frequency_panel_js() -> Response {
    static_response("text/javascript; charset=utf-8", FREQUENCY_PANEL_JS)
}

async fn thermochemistry_js() -> Response {
    static_response("text/javascript; charset=utf-8", THERMOCHEMISTRY_JS)
}

async fn trend_chart_js() -> Response {
    static_response("text/javascript; charset=utf-8", TREND_CHART_JS)
}

async fn vibration_js() -> Response {
    static_response("text/javascript; charset=utf-8", VIBRATION_JS)
}

async fn viewer_frame_js() -> Response {
    static_response("text/javascript; charset=utf-8", VIEWER_FRAME_JS)
}

async fn local_3dmol_js() -> Response {
    local_file_response("web/3Dmol-min.js", "text/javascript; charset=utf-8").await
}

async fn local_plotly_js() -> Response {
    local_file_response("web/plotly.min.js", "text/javascript; charset=utf-8").await
}

fn static_response(content_type: &'static str, body: &'static str) -> Response {
    ([(header::CONTENT_TYPE, content_type)], body).into_response()
}

async fn local_file_response(path: &str, content_type: &'static str) -> Response {
    match fs::read(path).await {
        Ok(body) => ([(header::CONTENT_TYPE, content_type)], body).into_response(),
        Err(_) => (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            format!("Not found: {path}"),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_xyz_output_path, format_frame_as_xyz, CliArgs};
    use crate::models::{Atom, Frame};
    use clap::Parser;
    use std::net::IpAddr;
    use std::path::PathBuf;

    #[test]
    fn parse_cli_defaults() {
        let args = ["molvis", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert_eq!(cfg.port, 3000);
        assert_eq!(cfg.host, "127.0.0.1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_custom_host_port() {
        let args = ["molvis", "-H", "0.0.0.0", "-p", "8080", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.host, "0.0.0.0".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_init_config() {
        let args = ["molvis", "--init-config"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert!(cfg.init_config);
        assert_eq!(cfg.out_path, None);
    }

    #[test]
    fn parse_cli_unknown_short_option() {
        let args = ["molvis", "-z", "job.out"];
        let err = CliArgs::try_parse_from(args).unwrap_err();
        assert!(err.to_string().contains("unexpected argument"));
    }

    #[test]
    fn parse_cli_export_last_xyz_short_flag() {
        let args = ["molvis", "-x", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert!(cfg.export_last_xyz);
        assert_eq!(cfg.output_name, None);
    }

    #[test]
    fn parse_cli_export_last_xyz_with_output_name() {
        let args = ["molvis", "-x", "-n", "job_opt", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert!(cfg.export_last_xyz);
        assert_eq!(cfg.output_name.as_deref(), Some("job_opt"));
    }

    #[test]
    fn parse_cli_export_last_xyz_with_hyphenated_output_name() {
        let args = ["molvis", "-x", "-n", "-m062x", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert!(cfg.export_last_xyz);
        assert_eq!(cfg.output_name.as_deref(), Some("-m062x"));
    }

    #[test]
    fn parse_cli_export_last_xyz_long_flag() {
        let args = ["molvis", "--xyz", "--name", "_opt", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert!(cfg.export_last_xyz);
        assert_eq!(cfg.output_name.as_deref(), Some("_opt"));
    }

    #[test]
    fn parse_cli_export_last_xyz_long_flag_with_hyphenated_output_name() {
        let args = ["molvis", "--xyz", "--name=-m062x", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, Some("job.out".to_string()));
        assert!(cfg.export_last_xyz);
        assert_eq!(cfg.output_name.as_deref(), Some("-m062x"));
    }

    #[test]
    fn build_xyz_output_path_defaults_to_input_stem() {
        let path = build_xyz_output_path("/tmp/demo/job.out", None);
        assert_eq!(path, PathBuf::from("/tmp/demo/job.xyz"));
    }

    #[test]
    fn build_xyz_output_path_appends_suffix_to_input_stem() {
        let path = build_xyz_output_path("/tmp/demo/job.out", Some("_opt"));
        assert_eq!(path, PathBuf::from("/tmp/demo/job_opt.xyz"));
    }

    #[test]
    fn format_frame_as_xyz_writes_standard_xyz_text() {
        let frame = Frame {
            step: 3,
            energy_hartree: Some(-123.456789),
            atoms: vec![
                Atom {
                    element: "C".to_string(),
                    x: 0.0,
                    y: 1.0,
                    z: 2.0,
                },
                Atom {
                    element: "H".to_string(),
                    x: -0.5,
                    y: 1.5,
                    z: 2.5,
                },
            ],
        };

        let xyz = format_frame_as_xyz(&frame);
        assert!(xyz.starts_with("2\nstep=3 energy_hartree=-123.4567890000\n"));
        assert!(xyz.contains("C      0.00000000"));
        assert!(xyz.contains("H     -0.50000000"));
    }
}

fn parse_cli_args() -> CliAction {
    let theme = resolve_cli_theme(parse_theme_arg_from_raw_args());
    let cmd = CliArgs::command().styles(styles_for_theme(theme));
    let matches = cmd.get_matches();
    let args = CliArgs::from_arg_matches(&matches).unwrap_or_else(|err| err.exit());
    if args.init_config {
        return CliAction::InitConfig;
    }

    let file_cfg = load_effective_config();
    let host_from_cli = matches.value_source("host") == Some(ValueSource::CommandLine);
    let port_from_cli = matches.value_source("port") == Some(ValueSource::CommandLine);
    let host = if host_from_cli {
        args.host
    } else {
        file_cfg.host.unwrap_or(args.host)
    };
    let port = if port_from_cli {
        args.port
    } else {
        file_cfg.port.unwrap_or(args.port)
    };
    let out_path = args
        .out_path
        .unwrap_or_else(|| unreachable!("path is required when not using --init-config"));

    if args.export_last_xyz {
        return CliAction::ExportLastXyz {
            out_path,
            output_name: args.output_name,
        };
    }

    CliAction::Run(CliConfig {
        out_path,
        host,
        port,
    })
}

fn load_effective_config() -> FileConfig {
    let mut cfg = FileConfig::default();
    for path in config_search_paths() {
        if path.exists() {
            let next = load_config_from_path(&path);
            cfg.host = next.host.or(cfg.host);
            cfg.port = next.port.or(cfg.port);
        }
    }
    cfg
}

fn load_config_from_path(path: &PathBuf) -> FileConfig {
    let content = match stdfs::read_to_string(path) {
        Ok(content) => content,
        Err(err) => {
            eprintln!("Warning: failed to read config '{}': {err}", path.display());
            return FileConfig::default();
        }
    };
    parse_simple_toml_config(path, &content)
}

fn parse_simple_toml_config(path: &PathBuf, content: &str) -> FileConfig {
    let mut cfg = FileConfig::default();
    for raw_line in content.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();
        match key {
            "host" => {
                let raw = value.trim_matches('"');
                match raw.parse::<IpAddr>() {
                    Ok(host) => cfg.host = Some(host),
                    Err(err) => eprintln!(
                        "Warning: invalid host value in '{}': {} ({err})",
                        path.display(),
                        raw
                    ),
                }
            }
            "port" => {
                let raw = value.trim_matches('"');
                match raw.parse::<u16>() {
                    Ok(port) => cfg.port = Some(port),
                    Err(err) => eprintln!(
                        "Warning: invalid port value in '{}': {} ({err})",
                        path.display(),
                        raw
                    ),
                }
            }
            _ => {}
        }
    }
    cfg
}

fn config_search_paths() -> Vec<PathBuf> {
    let mut paths = vec![PathBuf::from("/etc/molvis/config.toml")];
    if let Some(home) = env::var_os("HOME") {
        let user_dir = PathBuf::from(home).join(".config/molvis");
        paths.push(user_dir.join("config.toml"));
    }
    paths
}

fn init_user_config() -> Result<(), String> {
    let home = env::var_os("HOME").ok_or_else(|| "HOME is not set".to_string())?;
    let config_dir = PathBuf::from(home).join(".config/molvis");
    stdfs::create_dir_all(&config_dir)
        .map_err(|err| format!("create '{}': {err}", config_dir.display()))?;
    let config_path = config_dir.join("config.toml");
    if config_path.exists() {
        println!(
            "Config already exists at {} (kept unchanged)",
            config_path.display()
        );
        return Ok(());
    }
    let template = "host = \"127.0.0.1\"\nport = 3000\n";
    stdfs::write(&config_path, template)
        .map_err(|err| format!("write '{}': {err}", config_path.display()))?;
    println!("Initialized config at {}", config_path.display());
    Ok(())
}
