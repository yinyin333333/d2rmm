# Diablo II: Resurrected Mod Manager for D2RLoader

D2RMM Custom is a mod manager for Diablo II: Resurrected with D2RLoader.

This is a separately maintained project from the original D2RMM. It remains
compatible with the standard retail D2RMM workflow, while also providing
compatibility and optimizations for D2RLoader-based setups, including TCP
play.

## Usage

1. Click the **D2RLoader** button in the top menu. D2RLoader will be installed
   automatically.
2. Install any required MPQ files or mods written for the original D2RMM in
   the usual way.
3. Click **Install Mods**, then click **Run D2R**. The game will launch through
   D2RLoader.
4. To change D2RLoader options, open **Settings** and edit the D2RLoader TOML
   configuration values.
5. To run the original D2R without D2RLoader, disable the **D2RLoader**
   checkbox in **Settings**.

## D2RLoader Plugins

D2RLoader plugins are generally distributed as DLL and JSON files. They enable
hard mods that go beyond the limits of ordinary soft modding by extending or
changing the game's runtime behavior. DLL files provide the native plugin code,
while JSON files commonly contain plugin configuration or patch definitions.

## Example Mods

You can find some example mods over at [https://github.com/olegbl/d2rmm.mods](https://github.com/olegbl/d2rmm.mods). There are also [API Docs](https://olegbl.github.io/d2rmm/) available.

## Building

- [https://github.com/nodejs/node-gyp#on-windows](https://github.com/nodejs/node-gyp#on-windows)
- D2RMM uses Node v22 by default, so make sure to install that (e.g. via nvm).
- `git clone`
- `cd d2rmm`
- `yarn install`
- `yarn start` to run D2RMM in debug mode
- `yarn package` to build a release of D2RMM
- `yarn docs` to build documentation site
- `yarn build:updater` to build the auto-updater
- `yarn build:casclib` to build the CascLib native library
- `yarn build:config-schema` to build config json mod schema

## macOS Support (arm64 only, experimental)

> **Note:** macOS support is experimental and not officially supported. Things may not work as expected.

Pre-built releases are available (.dmg) for Apple Silicon Macs (M1/M2/M3/M4). Intel Macs are not currently supported.

Since Diablo II: Resurrected has no native MacOS version, you'll need to run the game using external tools (e.g. [CrossOver](https://www.codeweavers.com/crossover)). Launch D2R with the run options: `-mod D2RMM -txt`

Building from source follows the same steps as Windows. `yarn package` produces a `.dmg` in `release/build/`.

## linux support (experimental)

> **Note:** linux support is experimental and not officially supported. Things may not work as expected.

Pre-built releases are available (.tar.gz).

Since Diablo II: Resurrected has no native Linux version, you'll need to run the game using external tools (e.g. [Lutris](https://github.com/lutris/lutris)). Launch D2R with the run options: `-mod D2RMM -txt`

Building from source follows the same steps as Windows. `yarn package` produces a `.tar.gz` archive in `release/build/`.
