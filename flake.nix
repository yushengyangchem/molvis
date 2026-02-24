{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-parts = {
      url = "github:hercules-ci/flake-parts";
      inputs.nixpkgs-lib.follows = "nixpkgs";
    };
    git-hooks = {
      url = "github:cachix/git-hooks.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    gitignore = {
      url = "github:hercules-ci/gitignore.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  outputs =
    { flake-parts, gitignore, ... }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ inputs.git-hooks.flakeModule ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      perSystem =
        {
          config,
          self',
          pkgs,
          ...
        }:
        {
          packages.molvis = pkgs.callPackage ./default.nix { inherit (gitignore.lib) gitignoreSource; };
          packages.default = self'.packages.molvis;
          apps.molvis = {
            type = "app";
            program = "${self'.packages.molvis}/bin/molvis";
          };
          apps.default = self'.apps.molvis;
          devShells.default = pkgs.mkShell {
            inputsFrom = [ config.pre-commit.devShell ];
            packages = with pkgs; [
              cargo
              rustc
              just
            ];
          };

          pre-commit = {
            check.enable = true;
            settings.hooks = {
              nixfmt.enable = true;
              taplo = {
                enable = true;
                excludes = [ "Cargo.lock" ];
              };
              prettier = {
                enable = true;
                excludes = [ "flake.lock" ];
              };
              rustfmt.enable = true;
            };
          };
        };
    };
}
