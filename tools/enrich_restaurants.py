#!/usr/bin/env python3
"""Add missing OSM restaurants and store a proper thumbnail on every row."""

from __future__ import annotations

import json
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'data' / 'restaurants.seed.json'
UA = 'KSAGuide/1.0 (KSA expat guide; restaurant enrich)'
CTX = ssl.create_default_context()
HOSTS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter',
]

KIND_PHOTO = {
    'arab': 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=70',
    'chinese': 'https://images.unsplash.com/photo-1585032226651-759b368d7246?auto=format&fit=crop&w=900&q=70',
    'desi': 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&w=900&q=70',
    'turkish': 'https://images.unsplash.com/photo-1529042410759-befb1204b468?auto=format&fit=crop&w=900&q=70',
    'italian': 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=70',
    'american': 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=70',
    'japanese': 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&w=900&q=70',
    'korean': 'https://images.unsplash.com/photo-1498654896873-069dd5a4c047?auto=format&fit=crop&w=900&q=70',
    'seafood': 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=70',
    'cafe': 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=70',
    'thai': 'https://images.unsplash.com/photo-1559314809-0d155014e29e?auto=format&fit=crop&w=900&q=70',
}

CHICKEN = 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?auto=format&fit=crop&w=900&q=70'
SHAWARMA = 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?auto=format&fit=crop&w=900&q=70'
PIZZA = KIND_PHOTO['italian']
COFFEE = KIND_PHOTO['cafe']
BURGER = KIND_PHOTO['american']
SUSHI = KIND_PHOTO['japanese']
MANDI = KIND_PHOTO['arab']

BRAND_PHOTO = [
    (('albaik', 'al baik', 'البيك'), CHICKEN),
    (('herfy', 'هرفي'), BURGER),
    (('kudu', 'كودو'), CHICKEN),
    (("mcdonald", 'ماكدونالد'), BURGER),
    (('kfc', 'كنتاكي'), CHICKEN),
    (('burger king', 'برجر كنج'), BURGER),
    (('hardee', 'هارديز'), BURGER),
    (('shawarmer', 'شاورمر'), SHAWARMA),
    (('al tazaj', 'altazaj', 'الطازج'), CHICKEN),
    (('pizza hut', 'بيتزا هت'), PIZZA),
    (("domino", 'دومينوز'), PIZZA),
    (('maestro pizza', 'مايسترو'), PIZZA),
    (("papa john", 'بابا جونز'), PIZZA),
    (('starbucks', 'ستاربكس'), COFFEE),
    (('dunkin', 'دانكن'), COFFEE),
    (('tim horton', 'تم هورتن'), COFFEE),
    (('barn', "barn's", 'بارنز'), COFFEE),
    (('half million', '1/2 m', 'half milion'), COFFEE),
    (('percent arabica', '% arabica'), COFFEE),
    (('subway', 'صب واي'), KIND_PHOTO['american']),
    (('popeyes', 'بوبايز'), CHICKEN),
    (('texas chicken',), CHICKEN),
    (('shake shack',), BURGER),
    (('five guys',), BURGER),
    (('sushi',), SUSHI),
    (('najd village', 'قرية نجد'), MANDI),
    (('alromansiah', 'الرومانسية'), MANDI),
    (('alromansia',), MANDI),
    (('mandi', 'مندي'), MANDI),
    (('kabsa', 'كبسة'), MANDI),
    (('lusin',), KIND_PHOTO['turkish']),
    (('cinnabon',), COFFEE),
    (('house of donut', 'donut house'), COFFEE),
]

CITIES = [
    ('Jeddah', 21.5433, 39.1728, 28000),
    ('Jeddah North', 21.6700, 39.1500, 18000),
    ('Jeddah South', 21.4300, 39.2000, 16000),
    ('Jeddah East', 21.5433, 39.2600, 16000),
    ('Riyadh', 24.7136, 46.6753, 32000),
    ('Riyadh North', 24.8300, 46.6400, 18000),
    ('Riyadh East', 24.7200, 46.8200, 18000),
    ('Riyadh West', 24.7000, 46.5200, 16000),
    ('Makkah', 21.3891, 39.8579, 18000),
    ('Madinah', 24.5247, 39.5692, 18000),
    ('Dammam', 26.4207, 50.0888, 20000),
    ('Khobar', 26.2172, 50.1971, 16000),
    ('Taif', 21.2703, 40.4158, 16000),
]


def classify(raw: str, name: str) -> str:
    blob = f'{raw} {name}'.lower().replace('-', '_').replace(' ', '_')
    table = [
        ('desi', ('indian', 'pakistani', 'bangladeshi', 'punjabi', 'biryani', 'karachi', 'lahore')),
        ('chinese', ('chinese', 'wok', 'dim_sum', 'szechuan')),
        ('japanese', ('japanese', 'sushi', 'ramen')),
        ('korean', ('korean',)),
        ('thai', ('thai', 'vietnamese')),
        ('italian', ('italian', 'pizza', 'pasta')),
        ('turkish', ('turkish', 'kebab')),
        ('american', ('american', 'burger', 'chicken', 'kfc', 'mcdonald', 'herfy', 'kudu', 'baik')),
        ('seafood', ('seafood', 'fish', 'shrimp')),
        ('cafe', ('cafe', 'coffee', 'bakery', 'starbucks', 'dunkin')),
        ('arab', ('arab', 'saudi', 'lebanese', 'yemeni', 'egyptian', 'shawarma', 'mandi', 'kabsa')),
    ]
    for cat, keys in table:
        if any(key in blob for key in keys):
            return cat
    return 'arab'


def image_from_tags(tags: dict) -> str:
    for key in ('image', 'image:0', 'contact:image'):
        url = str(tags.get(key) or '').strip()
        if url.startswith('http'):
            return url
    wiki = str(tags.get('wikimedia_commons') or tags.get('wikimedia') or '').strip()
    if not wiki:
        return ''
    if wiki.startswith('http'):
        return wiki
    name = wiki[5:] if wiki.lower().startswith('file:') else wiki
    return (
        'https://commons.wikimedia.org/wiki/Special:FilePath/'
        f'{urllib.parse.quote(name)}?width=800'
    )


def brand_photo(name: str) -> str:
    blob = name.lower()
    for keys, url in BRAND_PHOTO:
        if any(key in blob for key in keys):
            return url
    return ''


def assign_image(place: dict) -> str:
    current = str(place.get('image') or '').strip()
    if current.startswith('http') and 'unsplash.com' not in current:
        return current
    branded = brand_photo(place.get('name') or '')
    if branded:
        return branded
    if current:
        return current
    return KIND_PHOTO.get(place.get('kind') or 'arab', KIND_PHOTO['arab'])


def overpass(query: str) -> dict:
    body = query.encode('utf-8')
    last = None
    for host in HOSTS:
        req = urllib.request.Request(
            host,
            data=body,
            headers={'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded'},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=80, context=CTX) as res:
                return json.loads(res.read().decode('utf-8'))
        except Exception as err:  # noqa: BLE001
            last = err
            time.sleep(1.2)
    raise RuntimeError(last)


def coords(el: dict) -> tuple[float, float] | None:
    if 'lat' in el and 'lon' in el:
        return float(el['lat']), float(el['lon'])
    center = el.get('center') or {}
    if 'lat' in center and 'lon' in center:
        return float(center['lat']), float(center['lon'])
    return None


def place_from(el: dict) -> dict | None:
    tags = el.get('tags') or {}
    xy = coords(el)
    if xy is None:
        return None
    lat, lng = xy
    if not (16.0 <= lat <= 32.6 and 34.4 <= lng <= 55.8):
        return None
    amenity = tags.get('amenity') or tags.get('shop') or 'restaurant'
    title = (
        tags.get('name:en')
        or tags.get('name')
        or tags.get('name:ar')
        or tags.get('brand')
        or ''
    ).strip() or {
        'fast_food': 'Fast food',
        'cafe': 'Cafe',
        'food_court': 'Food court',
        'ice_cream': 'Ice cream',
        'bakery': 'Bakery',
    }.get(amenity, 'Restaurant')
    cuisine_raw = (tags.get('cuisine') or '').replace(';', ', ')
    kind = classify(cuisine_raw, title)
    row = {
        'id': f"{el.get('type', 'n')}-{el.get('id')}",
        'name': title,
        'lat': round(lat, 6),
        'lng': round(lng, 6),
        'kind': kind,
        'cuisine': cuisine_raw,
        'city': tags.get('addr:city') or '',
        'phone': tags.get('phone') or tags.get('contact:phone') or '',
        'hours': tags.get('opening_hours') or '',
        'web': tags.get('website') or tags.get('contact:website') or '',
        'amenity': amenity,
        'image': image_from_tags(tags),
    }
    row['image'] = assign_image(row)
    return row


def save(existing: dict[str, dict]) -> None:
    for place in existing.values():
        place['image'] = assign_image(place)
    places = sorted(existing.values(), key=lambda item: item['name'].lower())
    kinds: dict[str, int] = {}
    for place in places:
        kinds[place['kind']] = kinds.get(place['kind'], 0) + 1
    SEED.write_text(
        json.dumps(
            {'count': len(places), 'kinds': kinds, 'places': places},
            ensure_ascii=False,
            separators=(',', ':'),
        )
        + '\n',
        encoding='utf-8',
    )


def main() -> None:
    existing: dict[str, dict] = {}
    if SEED.exists():
        raw = json.loads(SEED.read_text(encoding='utf-8'))
        for place in raw.get('places') or []:
            existing[place['id']] = place
    print(f'starting {len(existing)}', flush=True)
    added = 0
    for index, (name, lat, lng, radius) in enumerate(CITIES, 1):
        query = f"""[out:json][timeout:55];
(
  nwr["amenity"="restaurant"](around:{radius},{lat},{lng});
  nwr["amenity"="fast_food"](around:{radius},{lat},{lng});
  nwr["amenity"="cafe"](around:{radius},{lat},{lng});
  nwr["amenity"="food_court"](around:{radius},{lat},{lng});
  nwr["amenity"="ice_cream"](around:{radius},{lat},{lng});
  nwr["shop"="bakery"](around:{radius},{lat},{lng});
);
out center tags;
"""
        try:
            data = overpass(query)
        except Exception as err:  # noqa: BLE001
            print(f'{index}/{len(CITIES)} {name} FAIL {err}', flush=True)
            time.sleep(2)
            continue
        city_added = 0
        for el in data.get('elements') or []:
            row = place_from(el)
            if not row:
                continue
            current = existing.get(row['id'])
            if current is None:
                existing[row['id']] = row
                city_added += 1
                added += 1
            else:
                if not current.get('image') and row.get('image'):
                    current['image'] = row['image']
                if row.get('image') and 'unsplash.com' not in row['image']:
                    current['image'] = row['image']
                if not current.get('city') and row.get('city'):
                    current['city'] = row['city']
        print(f'{index}/{len(CITIES)} {name} +{city_added} total {len(existing)}', flush=True)
        time.sleep(0.8)
    save(existing)
    with_osm = sum(
        1
        for place in existing.values()
        if place.get('image') and 'unsplash.com' not in place['image']
    )
    print(f'wrote {len(existing)} (+{added}) osm/brand thumbs {with_osm} -> {SEED}')


if __name__ == '__main__':
    main()
