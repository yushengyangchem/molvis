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
use clap::Parser;
use serde_json::to_vec;
use std::{
    net::{IpAddr, SocketAddr},
    process,
    sync::Arc,
};
use tokio::fs;

const INDEX_HTML: &str = include_str!("../web/index.html");
const APP_JS: &str = include_str!("../web/app.js");
const STYLE_CSS: &str = include_str!("../web/style.css");
const CPK_COLORS_JS: &str = include_str!("../web/cpkColors.js");
const GEOMETRY_JS: &str = include_str!("../web/modules/geometry.js");
const MEASUREMENT_JS: &str = include_str!("../web/modules/measurement.js");
const MOL_BUILDER_JS: &str = include_str!("../web/modules/molBuilder.js");

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

#[derive(Debug, Parser)]
#[command(
    name = "molvis",
    version,
    about = "ORCA .out viewer",
    long_about = "CLI web viewer for ORCA .out trajectories with 3Dmol.js rendering.",
    styles = cli_styles(),
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
    #[arg(value_name = "PATH", help = "Path to ORCA .out file")]
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
}

fn cli_styles() -> Styles {
    Styles::styled()
        .header(AnsiColor::Cyan.on_default() | Effects::BOLD)
        .usage(AnsiColor::Cyan.on_default() | Effects::BOLD)
        .literal(AnsiColor::Green.on_default() | Effects::BOLD)
        .placeholder(AnsiColor::Yellow.on_default())
        .valid(AnsiColor::Green.on_default())
        .invalid(AnsiColor::Red.on_default() | Effects::BOLD)
        .error(AnsiColor::Red.on_default() | Effects::BOLD)
}

#[tokio::main]
async fn main() {
    let cli = parse_cli_args();

    let content = match fs::read_to_string(&cli.out_path).await {
        Ok(content) => content,
        Err(err) => {
            eprintln!("Failed to read ORCA .out file '{}': {err}", cli.out_path);
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
        .route("/style.css", get(style_css))
        .route("/cpkColors.js", get(cpk_colors_js))
        .route("/modules/geometry.js", get(geometry_js))
        .route("/modules/measurement.js", get(measurement_js))
        .route("/modules/molBuilder.js", get(mol_builder_js))
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

async fn style_css() -> Response {
    static_response("text/css; charset=utf-8", STYLE_CSS)
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
    let args = CliArgs::parse();
    CliConfig {
        out_path: args.out_path,
        host: args.host,
        port: args.port,
    }
}
