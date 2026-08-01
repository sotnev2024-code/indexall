#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Объединяет YOLO-экспорты Label Studio (папки images/ + labels/ + notes.json)
в один датасет для обучения.

Зачем отдельный скрипт: конвертер convert_ls_to_yolo.py работает с JSON-экспортом,
а Максим присылает готовый YOLO-экспорт. В нём class_id уже совпадают с
атрибутом category из конфига разметки (сервер Zeus ждёт именно их), поэтому
номера классов НЕ переписываем — только собираем партии вместе, делаем
train/val split и генерируем data.yaml с именами из notes.json.

Использование:
  python merge_yolo_export.py --out dataset ^
      "схемы/Новые схемы/project-3-..." "схемы/Новые схемы/project-6-..."

Дальше обучение (Colab, T4):
  yolo detect train data=dataset/data.yaml model=yolov8s.pt epochs=150 imgsz=1280 batch=8
"""
import argparse
import json
import random
import re
import shutil
import sys
import unicodedata
from pathlib import Path

IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp')


def slug(name: str) -> str:
    """'Circuit breaker — автоматический выключатель' → circuit_breaker"""
    en = name.split('—')[0].strip().lower()
    en = unicodedata.normalize('NFKD', en)
    return re.sub(r'^_+|_+$', '', re.sub(r'[^a-z0-9]+', '_', en)) or 'class'


def read_names(folder: Path) -> dict:
    """notes.json → {category_id: имя класса}"""
    notes = folder / 'notes.json'
    if not notes.is_file():
        return {}
    data = json.loads(notes.read_text(encoding='utf-8'))
    out = {}
    for c in data.get('categories', []):
        try:
            out[int(c['id'])] = str(c.get('name', ''))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folders', nargs='+', help='папки YOLO-экспорта (images/ + labels/)')
    ap.add_argument('--out', required=True, help='папка датасета на выходе')
    ap.add_argument('--val', type=float, default=0.15, help='доля валидации (0.15)')
    args = ap.parse_args()

    out = Path(args.out)
    items = []            # (img_path, label_path, префикс партии)
    names = {}
    used_ids = set()
    empty = 0

    for i, f in enumerate(args.folders, 1):
        folder = Path(f)
        img_dir, lbl_dir = folder / 'images', folder / 'labels'
        if not img_dir.is_dir() or not lbl_dir.is_dir():
            sys.exit(f'Не нашёл images/ и labels/ в {folder}')
        names.update(read_names(folder))
        found = 0
        for img in sorted(img_dir.iterdir()):
            if img.suffix.lower() not in IMG_EXT:
                continue
            lbl = lbl_dir / (img.stem + '.txt')
            if not lbl.is_file():
                empty += 1
                continue
            rows = [r for r in lbl.read_text(encoding='utf-8').splitlines() if r.strip()]
            if not rows:
                empty += 1
                continue
            for r in rows:
                try: used_ids.add(int(r.split()[0]))
                except (ValueError, IndexError): pass
            items.append((img, lbl, f'p{i}'))
            found += 1
        print(f'  {folder.name}: картинок с разметкой {found}')

    if not items:
        sys.exit('Не нашлось ни одной размеченной картинки')

    random.Random(42).shuffle(items)
    n_val = max(1, round(len(items) * args.val)) if len(items) > 3 else 0
    splits = {'val': items[:n_val], 'train': items[n_val:]}

    for split, rows in splits.items():
        (out / 'images' / split).mkdir(parents=True, exist_ok=True)
        (out / 'labels' / split).mkdir(parents=True, exist_ok=True)
        for img, lbl, pref in rows:
            # префикс партии — на случай одинаковых имён в разных экспортах
            stem = f'{pref}_{img.stem}'
            shutil.copy2(img, out / 'images' / split / (stem + img.suffix))
            shutil.copy2(lbl, out / 'labels' / split / (stem + '.txt'))

    nc = max(used_ids) + 1 if used_ids else 0
    yaml = ['# INDEXALL / Zeus — объединённый YOLO-экспорт Label Studio',
            '# class_id = category из конфига разметки (совпадает с сервером)',
            'train: images/train', f"val: images/{'val' if n_val else 'train'}",
            f'nc: {nc}', 'names:']
    for i in range(nc):
        yaml.append(f'  {i}: {slug(names[i]) if i in names else f"unused_{i}"}')
    (out / 'data.yaml').write_text('\n'.join(yaml) + '\n', encoding='utf-8')

    print(f'\nГотово: {out}')
    print(f'  картинок: {len(items)} (train {len(splits["train"])}, val {n_val})')
    print(f'  классов в разметке: {len(used_ids)} (nc={nc})')
    if empty:
        print(f'  пропущено картинок без рамок: {empty}')
    print('\nОбучение:')
    print(f'  yolo detect train data={out}/data.yaml model=yolov8s.pt epochs=150 imgsz=1280 batch=8')


if __name__ == '__main__':
    main()
