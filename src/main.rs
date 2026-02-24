mod models;
mod parser;

use axum::{
    extract::State,
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
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
const STYLE_CSS: &str = include_str!("../web/style.css");
const CPK_COLORS_JS: &str = include_str!("../web/cpkColors.js");

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

fn static_response(content_type: &'static str, body: &'static str) -> Response {
    ([(header::CONTENT_TYPE, content_type)], body).into_response()
}

fn print_usage_and_exit(code: i32) -> ! {
    eprintln!("molvis - ORCA .out viewer");
    eprintln!();
    eprintln!("Usage:");
    eprintln!("  cargo run -- [OPTIONS] <path-to-orca-out-file>");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  -H, --host <ip>      Bind host (default: 127.0.0.1)");
    eprintln!("  -p, --port <port>    Bind port (default: 3000)");
    eprintln!("  -h, --help           Show this help message");
    eprintln!();
    eprintln!("Examples:");
    eprintln!("  cargo run -- path/to/file.out");
    eprintln!("  cargo run -- -H 0.0.0.0 -p 8080 path/to/file.out");
    process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::parse_cli_args_from;
    use std::net::IpAddr;

    #[test]
    fn parse_cli_defaults() {
        let args = vec!["molvis".to_string(), "job.out".to_string()];
        let cfg = parse_cli_args_from(args.into_iter()).unwrap();
        assert_eq!(cfg.out_path, "job.out");
        assert_eq!(cfg.port, 3000);
        assert_eq!(cfg.host, "127.0.0.1".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_custom_host_port() {
        let args = vec![
            "molvis".to_string(),
            "-H".to_string(),
            "0.0.0.0".to_string(),
            "-p".to_string(),
            "8080".to_string(),
            "job.out".to_string(),
        ];
        let cfg = parse_cli_args_from(args.into_iter()).unwrap();
        assert_eq!(cfg.out_path, "job.out");
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.host, "0.0.0.0".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn parse_cli_unknown_short_option() {
        let args = vec![
            "molvis".to_string(),
            "-x".to_string(),
            "job.out".to_string(),
        ];
        let err = parse_cli_args_from(args.into_iter()).unwrap_err();
        assert!(err.contains("Unknown option"));
    }
}

fn parse_cli_args() -> CliConfig {
    let args = env::args();
    match parse_cli_args_from(args) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("{err}");
            print_usage_and_exit(2);
        }
    }
}

fn parse_cli_args_from<I>(args: I) -> Result<CliConfig, String>
where
    I: IntoIterator<Item = String>,
{
    let mut out_path: Option<String> = None;
    let mut host: IpAddr = "127.0.0.1".parse().unwrap();
    let mut port: u16 = 3000;

    let mut args = args.into_iter().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "-h" | "--help" => {
                print_usage_and_exit(0);
            }
            "-H" | "--host" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing value for --host/-H".to_string())?;
                host = value
                    .parse::<IpAddr>()
                    .map_err(|_| format!("Invalid --host/-H value: {value}"))?;
            }
            "-p" | "--port" => {
                let value = args
                    .next()
                    .ok_or_else(|| "Missing value for --port/-p".to_string())?;
                port = value
                    .parse::<u16>()
                    .map_err(|_| format!("Invalid --port/-p value: {value}"))?;
            }
            _ if arg.starts_with("--") || arg.starts_with('-') => {
                return Err(format!("Unknown option: {arg}"));
            }
            _ => {
                if out_path.is_some() {
                    return Err("Only one ORCA .out file path can be provided.".to_string());
                }
                out_path = Some(arg);
            }
        }
    }

    let out_path = out_path.ok_or_else(|| "Missing ORCA .out file path.".to_string())?;

    Ok(CliConfig {
        out_path,
        host,
        port,
    })
}
