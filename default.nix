{ pkgs, gitignoreSource }:
let
  cargoToml = fromTOML (builtins.readFile ./Cargo.toml);
in
pkgs.rustPlatform.buildRustPackage {
  pname = cargoToml.package.name;
  version = cargoToml.package.version;
  src = gitignoreSource ./.;
  cargoLock = {
    lockFile = ./Cargo.lock;
  };

  meta = with pkgs.lib; {
    description = cargoToml.package.description;
    homepage = cargoToml.package.repository;
    license = licenses.mit;
    mainProgram = cargoToml.package.name;
    maintainers = [
      {
        name = "yushengyangchem";
        email = "yushengyangchem@gmail.com";
      }
    ];
  };
}
