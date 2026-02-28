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
use clap::{CommandFactory, FromArgMatches, Parser, ValueEnum};
use serde_json::to_vec;
use std::{
    env,
    net::{IpAddr, SocketAddr},
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
    after_help = "Examples:\n  molvis path/to/file.out\n  molvis -H 0.0.0.0 -p 8080 path/to/file.out"
)]
struct CliArgs {
    #[arg(
        value_name = "PATH",
        help = "Path to molecular output file (currently ORCA .out)"
    )]
    out_path: String,
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

#[tokio::main]
async fn main() {
    let cli = parse_cli_args();

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

async fn get_parsed_data(State(state): State<AppState>) -> Response {
    (
        [(header::CONTENT_TYPE, "application/json; charset=utf-8")],
        (*state.parsed_json).clone(),
    )
        .into_response()
}

async fn index_html() -> Response {
    static_response("text/html; charset=utf-8", INDEX_HTML)
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
    use super::CliArgs;
    use clap::Parser;
    use std::net::IpAddr;

    #[test]
    fn parse_cli_defaults() {
        let args = ["molvis", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, "job.out");
        assert_eq!(cfg.port, 3000);
        assert_eq!(cfg.host, "127.0.0.1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_custom_host_port() {
        let args = ["molvis", "-H", "0.0.0.0", "-p", "8080", "job.out"];
        let cfg = CliArgs::try_parse_from(args).unwrap();
        assert_eq!(cfg.out_path, "job.out");
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.host, "0.0.0.0".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_unknown_short_option() {
        let args = ["molvis", "-x", "job.out"];
        let err = CliArgs::try_parse_from(args).unwrap_err();
        assert!(err.to_string().contains("unexpected argument"));
    }
}

fn parse_cli_args() -> CliConfig {
    let initial = CliArgs::parse();
    let theme = resolve_cli_theme(initial.term_theme);
    let cmd = CliArgs::command().styles(styles_for_theme(theme));
    let matches = cmd.get_matches();
    let args = CliArgs::from_arg_matches(&matches).unwrap_or_else(|err| err.exit());
    CliConfig {
        out_path: args.out_path,
        host: args.host,
        port: args.port,
    }
}
