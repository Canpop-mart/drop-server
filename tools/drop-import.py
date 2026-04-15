#!/usr/bin/env python3
"""
drop-import — Organize game archives for Drop server import.

Usage:
    python drop-import.py "Blue Prince.zip"
    python drop-import.py "Blue Prince.zip" --app-id 2556780
    python drop-import.py "Blue Prince.zip" --output Z:\media\games

Flow:
    1. Extract game name from the archive filename
    2. Search Steam for the App ID (or use --app-id)
    3. Look up the latest build ID from Steam
    4. Extract archive into: <output>/<Game Name>/<BuildID>/
"""

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
import urllib.request
import urllib.parse
from pathlib import Path


# ── Steam API helpers ──────────────────────────────────────────────────────

STEAM_SEARCH_URL = "https://store.steampowered.com/api/storesearch/?term={}&l=en&cc=US"
STEAM_APP_URL = "https://store.steampowered.com/api/appdetails?appids={}"
STEAM_APP_INFO_URL = "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={}&appid={}"


def search_steam_app(game_name: str) -> dict | None:
    """Search Steam store for a game by name. Returns {appid, name} or None."""
    url = STEAM_SEARCH_URL.format(urllib.parse.quote(game_name))
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
            items = data.get("items", [])
            if not items:
                return None
            # Try exact match first
            for item in items:
                if item["name"].lower() == game_name.lower():
                    return {"appid": item["id"], "name": item["name"]}
            # Fall back to first result
            return {"appid": items[0]["id"], "name": items[0]["name"]}
    except Exception as e:
        print(f"  [WARN] Steam search failed: {e}")
        return None


def get_latest_build_id(app_id: int) -> str | None:
    """
    Get the latest public build ID for a Steam app.
    Uses the public product info endpoint.
    """
    # Method 1: Try the undocumented productinfo endpoint
    url = f"https://api.steampowered.com/ISteamApps/GetAppList/v2/"

    # The most reliable way to get build IDs is via SteamCMD's app_info_print
    # or the Steam client API. For a simple tool, we'll try the web API approach
    # and fall back to asking the user.

    # Try the Steam product info API (requires no auth for public apps)
    try:
        info_url = f"https://store.steampowered.com/api/appdetails?appids={app_id}"
        with urllib.request.urlopen(info_url, timeout=10) as resp:
            data = json.loads(resp.read())
            app_data = data.get(str(app_id), {})
            if app_data.get("success"):
                # appdetails doesn't include build ID directly, but we can
                # get the last update timestamp as a reference
                pass
    except Exception:
        pass

    # The Steam Web API doesn't expose build IDs directly for most apps.
    # We'll need to use an alternative approach.

    # Try SteamDB's info page (not an API, but we can try)
    # Since we can't reliably scrape SteamDB, prompt the user
    return None


def prompt_build_id(app_id: int, game_name: str) -> str:
    """
    Prompt the user for the build ID since Steam's public API
    doesn't expose it reliably.
    """
    print(f"\n  Build ID not available from Steam API.")
    print(f"  Look it up at: https://steamdb.info/app/{app_id}/depots/")
    print(f"  (Check the 'Build ID' column for the latest public branch)")
    print()

    while True:
        build_id = input(f"  Enter the latest build ID for {game_name}: ").strip()
        if build_id and build_id.isdigit():
            return build_id
        print("  [!] Build ID must be a number. Try again.")


# ── Archive helpers ────────────────────────────────────────────────────────

def extract_game_name(filename: str) -> str:
    """
    Extract a clean game name from an archive filename.

    Examples:
        "Blue Prince.zip" → "Blue Prince"
        "Blue.Prince.v1.2.3.zip" → "Blue Prince"
        "Elden Ring - Shadow of the Erdtree.zip" → "Elden Ring - Shadow of the Erdtree"
        "Going_Medieval-v0.18.zip" → "Going Medieval"
    """
    name = Path(filename).stem

    # Remove common version patterns
    name = re.sub(r'[._-]v?\d+\.\d+[\.\d]*.*$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\s*\(.*?\)\s*$', '', name)  # Remove trailing (...)
    name = re.sub(r'\s*\[.*?\]\s*$', '', name)  # Remove trailing [...]

    # Replace dots and underscores with spaces (but not in "v1.2" patterns)
    name = name.replace('_', ' ').replace('.', ' ')

    # Clean up multiple spaces
    name = re.sub(r'\s+', ' ', name).strip()

    return name


def extract_archive(archive_path: str, dest_dir: str):
    """Extract a zip/7z archive to the destination directory."""
    archive_path = Path(archive_path)

    if archive_path.suffix.lower() == '.zip':
        with zipfile.ZipFile(archive_path, 'r') as zf:
            # Check if the zip has a single root folder
            top_level = set()
            for name in zf.namelist():
                parts = name.split('/')
                if parts[0]:
                    top_level.add(parts[0])

            if len(top_level) == 1:
                # Single root folder — extract contents of that folder directly
                root = top_level.pop()
                print(f"  Archive has root folder '{root}', extracting contents...")
                tmp = tempfile.mkdtemp()
                zf.extractall(tmp)
                src = os.path.join(tmp, root)
                # Move contents from the root folder to dest
                for item in os.listdir(src):
                    shutil.move(os.path.join(src, item), os.path.join(dest_dir, item))
                shutil.rmtree(tmp)
            else:
                # Multiple items at root — extract directly
                zf.extractall(dest_dir)
    elif archive_path.suffix.lower() in ('.7z', '.rar'):
        # Try py7zr for 7z files
        try:
            import py7zr
            with py7zr.SevenZipFile(str(archive_path), mode='r') as sz:
                sz.extractall(path=dest_dir)
        except ImportError:
            print("  [!] Install py7zr for .7z support: pip install py7zr")
            sys.exit(1)
    else:
        print(f"  [!] Unsupported archive format: {archive_path.suffix}")
        sys.exit(1)


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Organize game archives for Drop server import.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s "Blue Prince.zip"
  %(prog)s "Blue Prince.zip" --app-id 2556780
  %(prog)s "Blue Prince.zip" --build-id 20269474
  %(prog)s "Blue Prince.zip" --output Z:\\media\\games
        """,
    )
    parser.add_argument("archive", help="Path to the game archive (.zip, .7z)")
    parser.add_argument("--app-id", type=int, help="Steam App ID (skips search)")
    parser.add_argument("--build-id", help="Build ID (skips SteamDB lookup)")
    parser.add_argument("--name", help="Game name override (skips filename parsing)")
    parser.add_argument(
        "--output", "-o",
        default="./output",
        help="Output directory (default: ./output)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show what would happen without extracting")

    args = parser.parse_args()

    archive = Path(args.archive)
    if not archive.exists():
        print(f"[!] Archive not found: {archive}")
        sys.exit(1)

    # Step 1: Determine game name
    game_name = args.name or extract_game_name(archive.name)
    print(f"\n{'='*60}")
    print(f"  drop-import — Game Archive Organizer")
    print(f"{'='*60}")
    print(f"\n  Archive:    {archive.name}")
    print(f"  Game name:  {game_name}")

    # Step 2: Find Steam App ID
    app_id = args.app_id
    if not app_id:
        print(f"\n  Searching Steam for '{game_name}'...")
        result = search_steam_app(game_name)
        if result:
            app_id = result["appid"]
            steam_name = result["name"]
            print(f"  Found: {steam_name} (App ID: {app_id})")

            # Use Steam's official name if different
            if steam_name.lower() != game_name.lower():
                use_steam = input(f"  Use Steam name '{steam_name}'? [Y/n]: ").strip().lower()
                if use_steam != 'n':
                    game_name = steam_name
        else:
            print(f"  [!] Could not find '{game_name}' on Steam.")
            manual_id = input("  Enter Steam App ID manually (or press Enter to skip): ").strip()
            if manual_id and manual_id.isdigit():
                app_id = int(manual_id)
            else:
                print("  [!] Cannot determine build ID without App ID.")
                sys.exit(1)

    print(f"  App ID:     {app_id}")

    # Step 3: Get build ID
    build_id = args.build_id
    if not build_id:
        print(f"\n  Looking up latest build ID...")
        build_id_auto = get_latest_build_id(app_id)
        if build_id_auto:
            build_id = build_id_auto
            print(f"  Latest build: {build_id}")
        else:
            build_id = prompt_build_id(app_id, game_name)

    print(f"  Build ID:   {build_id}")

    # Step 4: Create folder structure
    output_base = Path(args.output)
    game_dir = output_base / game_name
    build_dir = game_dir / build_id

    print(f"\n  Output:     {build_dir}")

    if args.dry_run:
        print(f"\n  [DRY RUN] Would extract to: {build_dir}")
        print(f"  Done (dry run).")
        return

    if build_dir.exists():
        print(f"\n  [!] Output directory already exists: {build_dir}")
        overwrite = input("  Overwrite? [y/N]: ").strip().lower()
        if overwrite != 'y':
            print("  Aborted.")
            return
        shutil.rmtree(build_dir)

    build_dir.mkdir(parents=True, exist_ok=True)

    # Step 5: Extract archive
    print(f"\n  Extracting archive...")
    extract_archive(str(archive), str(build_dir))

    # Count files
    file_count = sum(1 for _ in build_dir.rglob('*') if _.is_file())
    total_size = sum(f.stat().st_size for f in build_dir.rglob('*') if f.is_file())
    size_gb = total_size / (1024 ** 3)

    print(f"  Extracted {file_count} files ({size_gb:.1f} GB)")
    print(f"\n  Ready at: {build_dir}")
    print(f"  Move to your Drop library when ready.")
    print(f"\n{'='*60}\n")


if __name__ == "__main__":
    main()
