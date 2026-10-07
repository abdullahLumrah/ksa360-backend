#!/usr/bin/env python3
"""Turn ksa_daily.catalog.json into shops.seed.json for GET /shops."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'data' / 'ksa_daily.catalog.json'
CATALOG_DIR = ROOT / 'data' / 'shop_catalog'
SEED = ROOT / 'data' / 'shops.seed.json'


def load_catalog() -> dict:
    if CATALOG.exists():
        return json.loads(CATALOG.read_text())
    categories = []
    for path in sorted(CATALOG_DIR.glob('*.json')):
        if path.name.startswith('saudi_coupons'):
            continue
        categories.append(json.loads(path.read_text()))
    if not categories:
        raise SystemExit(f'Missing catalog at {CATALOG} or {CATALOG_DIR}')
    return {'categories': categories}

CAT_MAP = {
    'perfumes_makeup': {
        'id': 'makeup-perfumes',
        'name': 'Perfumes & makeup',
        'blurb': 'Beauty shops, pharmacies, and perfume houses that deliver in Saudi Arabia.',
        'sort': 1,
    },
    'groceries': {
        'id': 'groceries',
        'name': 'Groceries',
        'blurb': 'Supermarkets, quick commerce, and grocery delivery apps.',
        'sort': 2,
    },
    'car_wash': {
        'id': 'car-wash',
        'name': 'Car wash',
        'blurb': 'Mobile car wash and car service apps in Saudi Arabia.',
        'sort': 3,
    },
    'maid_services': {
        'id': 'maid-services',
        'name': 'Maid & home services',
        'blurb': 'Hourly cleaning, live-in help, and recruitment apps including Musaned.',
        'sort': 4,
    },
}

FEATURED = {
    'nice-one',
    'ninja',
    'jazi',
    'ghaseel',
    'raha-smasco',
}

SUB_BLURB = {
    'beauty_retailer': 'Beauty retailer in KSA.',
    'makeup_brand': 'Makeup brand. Shop online or through a KSA retailer.',
    'perfume_brand': 'Perfume house with KSA delivery or stores.',
    'quick_commerce': 'Quick grocery delivery.',
    'marketplace': 'Marketplace for groceries and everyday orders.',
    'supermarket': 'Supermarket with KSA stores and delivery.',
    'delivery_app': 'Delivery app for groceries and more.',
    'b2b_wholesale': 'Wholesale grocery ordering.',
    'mobile_car_wash': 'Mobile car wash that comes to you.',
    'car_services': 'Car care, maintenance, and roadside help.',
    'hourly_and_monthly': 'Hourly and monthly domestic help.',
    'hourly_cleaning': 'Hourly home cleaning.',
    'recruitment_platform': 'Domestic worker recruitment.',
}

EXTRA_CATEGORIES = [
    {
        'id': 'shoes',
        'name': 'Shoes & sports',
        'blurb': 'Sneakers, sportswear, and the shops people use for football and gym kits.',
        'sort': 5,
        'icon': 'https://play-lh.googleusercontent.com/9RhfKZBBwhUjM4-liDvm9pTJ8GzSmnYLBJ05KX5rEpGZCsLix3IJLqGW02rk2krt9E4BQhc14BzncIe_9yhsZEY=s0-br30',
    },
    {
        'id': 'fashion',
        'name': 'Fashion & outlets',
        'blurb': 'Apparel, outlet stores, and everyday clothing apps in KSA.',
        'sort': 6,
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/dd/12/ad/dd12adf5-c447-a2fe-bf7d-1e70240bf07a/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.png/512x512bb.jpg',
    },
    {
        'id': 'electronics',
        'name': 'Electronics',
        'blurb': 'Phones, laptops, and home electronics with KSA delivery.',
        'sort': 7,
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/13/1f/c7/131fc781-b5c5-8040-b239-e9f357628c58/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg',
    },
]

EXTRA_LINKS = {
    'namshi': ['fashion', 'shoes'],
    'amazon-sa': ['electronics'],
    'noon-noon-minutes': ['electronics', 'fashion'],
}

COUPON_FILE = CATALOG_DIR / 'saudi_coupons.json'

COUPON_CATEGORIES = [
    {
        'id': 'food',
        'name': 'Food & restaurants',
        'blurb': 'Restaurant apps, food delivery, coffee, and meal plans.',
        'sort': 8,
        'icon': '',
    },
    {
        'id': 'home',
        'name': 'Home & furniture',
        'blurb': 'Furniture, bedding, kitchen, and home supplies.',
        'sort': 9,
        'icon': '',
    },
    {
        'id': 'travel',
        'name': 'Travel',
        'blurb': 'Hotels, flights, car hire, taxis, and eSIMs.',
        'sort': 10,
        'icon': '',
    },
    {
        'id': 'gifts',
        'name': 'Gifts & flowers',
        'blurb': 'Flowers, gifts, and occasion delivery.',
        'sort': 11,
        'icon': '',
    },
    {
        'id': 'kids',
        'name': 'Kids & baby',
        'blurb': 'Baby, kids clothing, and parent shops.',
        'sort': 12,
        'icon': '',
    },
    {
        'id': 'more',
        'name': 'More apps',
        'blurb': 'Other KSA apps with codes: education, insurance, and services.',
        'sort': 13,
        'icon': '',
    },
]

NAME_ALIASES = {
    'jahez': 'jahez-jahez-mart',
    'hungerstation': 'hungerstation-hmart',
    'noon': 'noon-noon-minutes',
    'panda': 'panda-hyperpanda',
    'othaim': 'othaim-markets',
    'sweater': 'sweeter',
    'dkhoni': 'dkhoon-al-emaratiya',
    'dkhoon': 'dkhoon-al-emaratiya',
    'almajedoud': 'al-majed-oud',
    'aldawaa': 'al-dawaa-pharmacies',
    'whitespharmacy': 'whites-pharmacy',
    'abdulsamadalqurashi': 'abdul-samad-al-qurashi',
    'centerpoint': 'centrepoint',
}

CAT_KEYWORDS = [
    ('car-wash', (
        'car wash', 'carwash', 'oil change', 'car maintenance', 'car care',
        'wash your car', 'car screens',
    )),
    ('maid-services', (
        'maid', 'home service', 'home services', 'cleaners', 'hourly cleaning',
        'laundry', 'maintenance services', 'cleaning tools',
    )),
    ('travel', (
        'hotel', 'flight', 'airline', 'travel', 'car rental', 'taxi', 'esim',
        'e-sim', 'sim card', 'airport', 'visa', 'chalet', 'apartment booking',
    )),
    ('gifts', (
        'flower', 'bouquet', 'gifts', 'gift ', 'occasion',
    )),
    ('kids', (
        'children', 'child', 'baby', 'kids', 'mother', 'parenting', 'toys',
    )),
    ('groceries', (
        'grocer', 'supermarket', 'hypermarket', 'vegetables', 'fruits',
        'butcher', 'water bottle', 'drinking water', 'wholesale grocery',
    )),
    ('food', (
        'restaurant', 'pizza', 'shawarma', 'burger', 'food delivery',
        'bakery', 'chocolate', 'coffee', 'meal', 'dates', 'honey', 'sweet',
        'cafe', 'roaster', 'seafood', 'poultry', 'kebab', 'chinese restaurant',
    )),
    ('makeup-perfumes', (
        'perfume', 'oud', 'makeup', 'beauty', 'cosmetic', 'pharmacy',
        'skin', 'hair', 'fragrance', 'incense', 'saffron', 'bakhoor',
    )),
    ('shoes', (
        'shoe', 'sneaker', 'sportswear', 'sports brand', 'sports clothing',
        'gym', 'fitness', 'sports equipment',
    )),
    ('electronics', (
        'electronic', 'laptop', 'smartphone', 'gaming', 'games', 'gift card',
        'smart device', 'appliances', 'electrical',
    )),
    ('fashion', (
        'fashion', 'clothing', 'clothes', 'abaya', 'dress', 'outlet',
        'apparel', "men's clothing", 'women', 'watch', 'jewelry',
        'jewellery', 'bags', 'abaya', 'corset',
    )),
    ('home', (
        'furniture', 'mattress', 'bedding', 'kitchen', 'home essentials',
        'home furniture', 'decor', 'linen', 'household', 'lighting',
        'sanitary',
    )),
]

EXTRA_MERCHANTS = [
    {
        'id': 'jazi',
        'name': 'Jazi | جازي',
        'blurb': 'Saudi ultra-fast fashion app with delivery across the kingdom.',
        'website': 'https://jazi.com',
        'androidId': 'com.jazi.app',
        'iosId': '6741321308',
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/dd/12/ad/dd12adf5-c447-a2fe-bf7d-1e70240bf07a/AppIcon-0-0-1x_U007ephone-0-1-0-85-220.png/512x512bb.jpg',
        'kind': 'app',
        'featured': True,
        'sort': 0,
        'categories': ['fashion'],
    },
    {
        'id': 'sssports',
        'name': 'Sun & Sand Sports',
        'blurb': 'GCC sports retailer for Nike, adidas, Puma and more, with KSA delivery.',
        'website': 'https://en-sa.sssports.com',
        'androidId': 'com.sssports.sssports',
        'iosId': '1163601891',
        'icon': 'https://play-lh.googleusercontent.com/9RhfKZBBwhUjM4-liDvm9pTJ8GzSmnYLBJ05KX5rEpGZCsLix3IJLqGW02rk2krt9E4BQhc14BzncIe_9yhsZEY=s0-br30',
        'kind': 'app',
        'sort': 200,
        'categories': ['shoes', 'fashion'],
    },
    {
        'id': 'adidas',
        'name': 'adidas',
        'blurb': 'Official adidas shop for shoes, football kits, and Originals in Saudi Arabia.',
        'website': 'https://www.adidas.com.sa',
        'androidId': 'com.adidas.app',
        'iosId': '1266591536',
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/96/d7/41/96d74176-ee25-ca78-dddb-5c0cce7106ef/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg',
        'kind': 'app',
        'sort': 201,
        'categories': ['shoes'],
    },
    {
        'id': 'adidas-confirmed',
        'name': 'adidas CONFIRMED',
        'blurb': 'Drops and limited sneakers from adidas, including draws and member releases.',
        'website': 'https://www.adidas.com.sa',
        'androidId': 'com.adidas.confirmed.app',
        'iosId': '',
        'icon': 'https://play-lh.googleusercontent.com/dAO4FRDSMTO4ndVEL_JkCL9X4qLgfDE2CU6-gB28Dc7kilWYMk7I4LcDywHLpzOO49xvj5skSUZm7TQcFxvFrW8=s0-br30',
        'kind': 'app',
        'sort': 202,
        'categories': ['shoes'],
    },
    {
        'id': 'nike',
        'name': 'Nike',
        'blurb': 'Nike shoes and apparel on nike.com/sa.',
        'website': 'https://www.nike.com/sa',
        'androidId': 'com.nike.omega',
        'iosId': '',
        'icon': 'https://play-lh.googleusercontent.com/HF1dbeyo0XYM3eMn9O1W41ccasIg8qk565xVTk8IRJR0futX3x2NmiEcw17z-XggxQiGOqm3ogu5iqkXrrhXxA=s0-br30',
        'kind': 'app',
        'sort': 203,
        'categories': ['shoes'],
    },
    {
        'id': 'brands-for-less',
        'name': 'Brands For Less',
        'blurb': 'Outlet fashion, shoes, and home brands at reduced prices, with KSA stores and an app.',
        'website': 'https://www.brandsforless.com/en-sa/',
        'androidId': 'ae.brandsforless.android',
        'iosId': '1039840915',
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/69/71/63/697163c9-5f04-93e6-783f-b4c72dfc83ca/appIconDefault-0-0-1x_U007emarketing-0-8-0-85-220.png/512x512bb.jpg',
        'kind': 'app',
        'sort': 204,
        'categories': ['shoes', 'fashion'],
    },
    {
        'id': 'jarir',
        'name': 'Jarir Bookstore',
        'blurb': 'Jarir Bookstore app for books, electronics, and stationery, with KSA delivery and store pickup.',
        'website': 'https://www.jarir.com',
        'androidId': 'com.jarirbookstore.JBMarketingApp',
        'iosId': '535777677',
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/13/1f/c7/131fc781-b5c5-8040-b239-e9f357628c58/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg',
        'kind': 'app',
        'sort': 205,
        'categories': ['electronics'],
    },
    {
        'id': 'extra',
        'name': 'eXtra',
        'blurb': 'eXtra app for phones, TVs, and home appliances with KSA delivery.',
        'website': 'https://www.extra.com/en-sa/',
        'androidId': 'com.asgatech.extra',
        'iosId': '584430757',
        'icon': 'https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b6/76/84/b676840a-89e9-a796-6865-4bf891e7e59e/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg',
        'kind': 'app',
        'sort': 206,
        'categories': ['electronics'],
    },
]

DROP_COUPONS = {
    ('nice-one', 'DW530'),
}

EXTRA_COUPONS = [
    {
        'id': 'nice-one-nl1gk',
        'merchantId': 'nice-one',
        'title': '10–20%',
        'detail': 'Gives 10–20% in the Nice One app.',
        'code': 'NL1GK',
        'url': 'https://niceonesa.com',
    },
]

COUPON_MERCHANT = {
    'niceone': 'nice-one',
    'sephora-ksa': 'sephora',
    'asaq': 'abdul-samad-al-qurashi',
    'ibraq': 'ibraq-ibrahim-al-qurashi',
    'dkhoon-emirates': 'dkhoon-al-emaratiya',
    'hungerstation': 'hungerstation-hmart',
    'othaim': 'othaim-markets',
    'panda': 'panda-hyperpanda',
    'noon': 'noon-noon-minutes',
}


def ios_id(url: str | None) -> str:
    if not url:
        return ''
    match = re.search(r'/id(\d+)', url)
    return match.group(1) if match else ''


def android_id(item: dict) -> str:
    package = str(item.get('android_package') or '').strip()
    if package:
        return package
    url = str(item.get('google_play_url') or '')
    match = re.search(r'[?&]id=([^&]+)', url)
    return match.group(1) if match else ''


def logo(item: dict) -> str:
    return str(item.get('logo_url') or '').strip()


def blurb_for(item: dict) -> str:
    arabic = str(item.get('name_ar') or '').strip()
    detail = SUB_BLURB.get(str(item.get('subcategory') or ''), '')
    if arabic and detail:
        return f'{arabic}. {detail}'
    return arabic or detail


def slugify(text: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', (text or '').lower()).strip('-')
    return slug or 'shop'


def norm_name(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '', (text or '').lower())


def classify_company(company: dict) -> str:
    blob = ' '.join(
        [
            str(company.get('name_en') or ''),
            str(company.get('name_ar') or ''),
            str(company.get('category') or ''),
            str(company.get('website') or ''),
        ]
    ).lower()
    for category_id, words in CAT_KEYWORDS:
        if any(word in blob for word in words):
            return category_id
    return 'more'


def coupon_indexes(merchants: dict[str, dict]) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    by_android: dict[str, str] = {}
    by_ios: dict[str, str] = {}
    by_name: dict[str, str] = {}
    for merchant in merchants.values():
        android = str(merchant.get('androidId') or '').lower()
        ios = str(merchant.get('iosId') or '')
        if android:
            by_android[android] = merchant['id']
        if ios:
            by_ios[ios] = merchant['id']
        by_name[norm_name(merchant.get('name') or '')] = merchant['id']
        by_name[norm_name(merchant['id'])] = merchant['id']
    return by_android, by_ios, by_name


def match_company(company: dict, merchants: dict[str, dict], indexes) -> str | None:
    by_android, by_ios, by_name = indexes
    android = android_id(company).lower()
    ios = ios_id(company.get('app_store_url'))
    if android and android in by_android:
        return by_android[android]
    if ios and ios in by_ios:
        return by_ios[ios]
    name_key = norm_name(company.get('name_en') or '')
    if name_key in NAME_ALIASES and NAME_ALIASES[name_key] in merchants:
        return NAME_ALIASES[name_key]
    if name_key and name_key in by_name:
        return by_name[name_key]
    if name_key and len(name_key) >= 5:
        for key, merchant_id in by_name.items():
            if name_key in key or key in name_key:
                return merchant_id
    return None


def merchant_from_company(company: dict, category_id: str, sort: int) -> dict:
    android = android_id(company)
    ios = ios_id(company.get('app_store_url'))
    thumb = str(company.get('app_icon_url') or company.get('logo_url') or '').strip()
    name = str(company.get('name_en') or '').strip() or 'Shop'
    arabic = str(company.get('name_ar') or '').strip()
    detail = str(company.get('category') or '').strip()
    blurb = '. '.join(part for part in (arabic, detail) if part)
    return {
        'id': slugify(name),
        'name': name,
        'blurb': blurb,
        'website': str(company.get('website') or ''),
        'androidId': android,
        'iosId': ios,
        'image': thumb,
        'icon': thumb,
        'kind': 'app' if android or ios else 'web',
        'featured': False,
        'sort': sort,
        'categories': [category_id],
    }


def coupon_from_company(company: dict, merchant_id: str) -> list[dict]:
    rows = []
    for item in company.get('coupons') or []:
        coupon_id = str(item.get('coupon_id') or '').strip()
        code = str(item.get('code') or '').strip()
        if not coupon_id or not code:
            continue
        value = str(item.get('value') or '').strip()
        title_ar = str(item.get('title_ar') or '').strip()
        title = ' · '.join(part for part in (value, title_ar) if part) or code
        rows.append(
            {
                'id': f'sahseh-{coupon_id}',
                'merchantId': merchant_id,
                'title': title,
                'detail': str(item.get('conditions_en') or item.get('conditions_ar') or ''),
                'code': code,
                'url': str(item.get('shop_url') or company.get('website') or ''),
            }
        )
    return rows


def ensure_category(categories: list[dict], category_id: str) -> None:
    if any(item['id'] == category_id for item in categories):
        return
    extra = next((item for item in COUPON_CATEGORIES if item['id'] == category_id), None)
    if not extra:
        extra = next(item for item in COUPON_CATEGORIES if item['id'] == 'more')
        category_id = 'more'
    categories.append(
        {
            'id': extra['id'],
            'name': extra['name'],
            'blurb': extra['blurb'],
            'image': extra['icon'],
            'icon': extra['icon'],
            'sort': extra['sort'],
        }
    )


def fill_category_icons(categories: list[dict], merchants: dict[str, dict]) -> None:
    for category in categories:
        if category.get('icon'):
            continue
        for merchant in merchants.values():
            if category['id'] in merchant.get('categories', []) and merchant.get('icon'):
                category['icon'] = merchant['icon']
                category['image'] = merchant['icon']
                break


def ingest_coupons(merchants: dict[str, dict], categories: list[dict]) -> list[dict]:
    if not COUPON_FILE.exists():
        return []
    raw = json.loads(COUPON_FILE.read_text())
    companies = raw.get('companies') or []
    indexes = coupon_indexes(merchants)
    coupons: list[dict] = []
    added = 0
    matched = 0
    sort_base = 400
    for company in companies:
        merchant_id = match_company(company, merchants, indexes)
        if merchant_id:
            matched += 1
        else:
            category_id = classify_company(company)
            ensure_category(categories, category_id)
            row = merchant_from_company(company, category_id, sort_base + added)
            taken = row['id']
            if taken in merchants:
                row['id'] = f'{taken}-{company.get("store_id") or added}'
            merchants[row['id']] = row
            merchant_id = row['id']
            indexes = coupon_indexes(merchants)
            added += 1
        coupons.extend(coupon_from_company(company, merchant_id))
    fill_category_icons(categories, merchants)
    print(f'Coupons: matched {matched} existing shops, added {added} shops, {len(coupons)} codes')
    return coupons


def merchant_from_item(item: dict, category_id: str, sort: int) -> dict:
    android = android_id(item)
    ios = ios_id(item.get('app_store_url'))
    thumb = logo(item)
    return {
        'id': item['id'],
        'name': item['name_en'],
        'blurb': blurb_for(item),
        'website': str(item.get('website') or ''),
        'androidId': android,
        'iosId': ios,
        'image': thumb,
        'icon': thumb,
        'kind': 'app' if android or ios else 'web',
        'featured': item['id'] in FEATURED,
        'sort': sort,
        'categories': [category_id],
    }


def main() -> None:
    catalog = load_catalog()
    old = json.loads(SEED.read_text()) if SEED.exists() else {'coupons': []}

    categories = []
    merchants: dict[str, dict] = {}
    cat_icons: dict[str, str] = {}

    for raw_cat in catalog.get('categories') or []:
        mapped = CAT_MAP[raw_cat['id']]
        cat_id = mapped['id']
        items = raw_cat.get('items') or []
        thumb = ''
        for item in items:
            if item.get('logo_source') in {'app_store', 'google_play'} and logo(item):
                thumb = logo(item)
                break
        if not thumb:
            for item in items:
                if logo(item):
                    thumb = logo(item)
                    break
        cat_icons[cat_id] = thumb
        categories.append(
            {
                'id': cat_id,
                'name': mapped['name'],
                'blurb': mapped['blurb'],
                'image': thumb,
                'icon': thumb,
                'sort': mapped['sort'],
            }
        )
        base_sort = mapped['sort'] * 100
        for index, item in enumerate(items, start=1):
            row = merchant_from_item(item, cat_id, base_sort + index)
            existing = merchants.get(row['id'])
            if existing:
                cats = list(dict.fromkeys(existing['categories'] + row['categories']))
                existing['categories'] = cats
                continue
            merchants[row['id']] = row

    for extra in EXTRA_CATEGORIES:
        categories.append(
            {
                'id': extra['id'],
                'name': extra['name'],
                'blurb': extra['blurb'],
                'image': extra['icon'],
                'icon': extra['icon'],
                'sort': extra['sort'],
            }
        )

    for extra in EXTRA_MERCHANTS:
        row = dict(extra)
        row['image'] = row.get('icon') or ''
        row['featured'] = bool(row.get('featured') or row['id'] in FEATURED)
        merchants[row['id']] = row

    for merchant_id, extra_cats in EXTRA_LINKS.items():
        row = merchants.get(merchant_id)
        if not row:
            continue
        row['categories'] = list(dict.fromkeys(row['categories'] + extra_cats))

    keep_ids = set(merchants)
    coupons = ingest_coupons(merchants, categories)
    seen_coupon_ids = {row['id'] for row in coupons}
    seen_codes = {(row['merchantId'], str(row.get('code') or '').upper()) for row in coupons}
    extra_first = []
    for coupon in EXTRA_COUPONS:
        merchant_id = coupon['merchantId']
        code = str(coupon.get('code') or '').upper()
        if merchant_id not in keep_ids or not code:
            continue
        if coupon['id'] in seen_coupon_ids or (merchant_id, code) in seen_codes:
            continue
        extra_first.append(dict(coupon))
        seen_coupon_ids.add(coupon['id'])
        seen_codes.add((merchant_id, code))
    coupons = extra_first + coupons
    for coupon in old.get('coupons') or []:
        merchant_id = COUPON_MERCHANT.get(coupon['merchantId'], coupon['merchantId'])
        if merchant_id not in keep_ids:
            continue
        if not str(coupon.get('code') or '').strip():
            continue
        if coupon.get('id') in seen_coupon_ids:
            continue
        row = dict(coupon)
        row['merchantId'] = merchant_id
        coupons.append(row)

    coupons = [
        row
        for row in coupons
        if (row['merchantId'], str(row.get('code') or '').upper()) not in DROP_COUPONS
    ]

    seed = {
        'categories': categories,
        'merchants': list(merchants.values()),
        'coupons': coupons,
    }
    SEED.write_text(json.dumps(seed, ensure_ascii=False, indent=2) + '\n')
    print(
        f'Wrote {SEED} ({len(categories)} categories, {len(merchants)} merchants, {len(coupons)} coupons)'
    )


if __name__ == '__main__':
    main()
