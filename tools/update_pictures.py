"""Builds pictures.json from the Reddit RSS feeds of the subreddits in subreddits.txt.

The game cannot read Reddit directly (CORS), so this script runs ahead of time,
daily via GitHub Actions or by hand, and the game loads the resulting file.
Posts without a thumbnail in the feed are NSFW: Reddit withholds thumbnails for them.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUBS_FILE = ROOT / 'tools' / 'subreddits.txt'
OUT_FILE = ROOT / 'pictures.json'
FEED = 'https://www.reddit.com/r/{}/top/.rss?t=month&limit=100'
USER_AGENT = 'sudoku-pictures/1.0 (+https://github.com/jjkramhoeft/sudoku)'
DELAY = 6  # seconds between feeds; Reddit rate-limits unauthenticated RSS
NS = {'a': 'http://www.w3.org/2005/Atom', 'media': 'http://search.yahoo.com/mrss/'}
IMAGE = re.compile(r'href="(https://(?:i\.redd\.it|i\.imgur\.com)/[^"?]+\.(?:jpe?g|png|webp))"', re.I)


def read_subs():
    lines = SUBS_FILE.read_text(encoding='utf-8').splitlines()
    return [s.strip() for s in lines if s.strip() and not s.lstrip().startswith('#')]


def fetch_feed(sub):
    req = urllib.request.Request(FEED.format(sub), headers={'User-Agent': USER_AGENT})
    for attempt in range(4):
        wait = 30 * (attempt + 1)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            retry_after = e.headers.get('Retry-After', '')
            if retry_after.isdigit():
                wait = max(wait, int(retry_after))
            print(f'  r/{sub}: attempt {attempt + 1} failed: {e}')
        except Exception as e:
            print(f'  r/{sub}: attempt {attempt + 1} failed: {e}')
        if attempt < 3:
            time.sleep(wait)
    return None


def parse_feed(sub, data):
    pictures = []
    for entry in ET.fromstring(data).findall('a:entry', NS):
        content = html.unescape(entry.findtext('a:content', '', NS))
        image = IMAGE.search(content)
        if not image:
            continue  # text, video or gallery post
        link = entry.find('a:link', NS)
        pictures.append({
            'url': image.group(1),
            'link': link.get('href') if link is not None else f'https://www.reddit.com/r/{sub}',
            'title': html.unescape(entry.findtext('a:title', '', NS)).strip(),
            'sub': sub,
            'nsfw': entry.find('media:thumbnail', NS) is None,
        })
    return pictures


def main():
    sys.stdout.reconfigure(line_buffering=True)
    subs = read_subs()
    old = {}
    if OUT_FILE.exists():
        for p in json.loads(OUT_FILE.read_text(encoding='utf-8')).get('pictures', []):
            old.setdefault(p['sub'], []).append(p)

    pictures, fetched = [], 0
    for i, sub in enumerate(subs):
        if i:
            time.sleep(DELAY)
        data = fetch_feed(sub)
        found = parse_feed(sub, data) if data else []
        if found:
            fetched += 1
            print(f'r/{sub}: {len(found)} pictures ({sum(p["nsfw"] for p in found)} NSFW)')
        else:
            found = old.get(sub, [])
            print(f'r/{sub}: nothing fetched, keeping {len(found)} previous pictures')
        pictures += found

    if not fetched:
        sys.exit('No feed could be fetched; pictures.json left unchanged.')

    out = {
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'subs': subs,
        'pictures': pictures,
    }
    OUT_FILE.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Wrote {len(pictures)} pictures from {fetched}/{len(subs)} subreddits to {OUT_FILE.name}')


if __name__ == '__main__':
    main()
