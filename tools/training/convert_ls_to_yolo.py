#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Конвертер разметки Label Studio (JSON) → датасет YOLO для обучения.

ВАЖНО: номера классов берутся из атрибута category в XML-конфиге разметки
(Label value="MCB — модульный автомат" category="0" …) — ровно так же их
понимает сервер ИНДЕКСАЛЛ при инференсе. Стандартный YOLO-экспорт из самого
Label Studio нумерует классы по порядку меток в конфиге и С СЕРВЕРОМ НЕ
СОВПАДАЕТ (например, Fused terminal стоит 12-м, но имеет category=34) —
поэтому конвертируйте именно этим скриптом.

Использование:
  python convert_ls_to_yolo.py --json export.json --images ./images \
      --config config.xml --out ./dataset [--val 0.15]

  export.json — экспорт из Label Studio: Export → JSON
  ./images    — папка с картинками схем (как загружались в LS)
  config.xml  — конфиг разметки (Settings → Labeling Interface → Code)
  ./dataset   — куда собрать датасет (images/train|val, labels/…, data.yaml)

Дальше обучение (pip install ultralytics):
  yolo detect train data=./dataset/data.yaml model=yolov8s.pt epochs=150 imgsz=1280
"""
import argparse
import json
import random
import re
import shutil
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote


def slug(ls_value: str) -> str:
    """'Fused terminal — клемма…' → fused_terminal (как на сервере)."""
    en = ls_value.split('—')[0].strip().lower()
    en = unicodedata.normalize('NFKD', en)
    return re.sub(r'^_+|_+$', '', re.sub(r'[^a-z0-9]+', '_', en)) or 'other'


def parse_config(xml_text: str):
    """XML конфига → {lsValue: category}, names[category] = slug."""
    value_to_cat = {}
    for m in re.finditer(r'<Label\s+([^>]*?)/>', xml_text, re.S):
        attrs = m.group(1)
        value = re.search(r'value="([^"]*)"', attrs)
        cat = re.search(r'category="(\d+)"', attrs)
        if not value or not cat:
            continue
        value_to_cat[value.group(1)] = int(cat.group(1))
    if not value_to_cat:
        sys.exit('В конфиге не нашлось меток <Label … category="N"/>')
    max_cat = max(value_to_cat.values())
    names = [f'unused_{i}' for i in range(max_cat + 1)]
    for v, c in value_to_cat.items():
        names[c] = slug(v)
    return value_to_cat, names


def norm_name(name: str) -> str:
    """Нормализация имени для матчинга: LS заменяет пробелы/запятые/скобки
    на подчёркивания и добавляет префикс-хэш — сравниваем только буквы/цифры."""
    stem = re.sub(r'\.[A-Za-z0-9]+$', '', name)          # без расширения
    stem = re.sub(r'^[0-9a-f]{8}-', '', stem)            # без префикса LS
    return re.sub(r'[^0-9a-zа-яё]', '', stem.lower())


def build_index(images_dir: Path):
    """имя файла и нормализованное имя → путь (для быстрого поиска)."""
    exact: dict = {}
    normed: dict = {}
    for p in sorted(images_dir.rglob('*')):
        if not p.is_file() or p.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
            continue
        exact.setdefault(p.name, p)
        normed.setdefault(norm_name(p.name), p)
    return exact, normed


def find_image(index, image_ref: str):
    exact, normed = index
    base = unquote(image_ref.split('/')[-1].split('?')[0])
    if base in exact:
        return exact[base]
    nb = norm_name(base)
    if nb in normed:
        return normed[nb]
    # последний шанс: нормализованное имя файла — суффикс ссылки или наоборот
    for nn, p in normed.items():
        if nn and (nb.endswith(nn) or nn.endswith(nb)):
            return p
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--json', required=True, help='экспорт Label Studio (JSON)')
    ap.add_argument('--images', required=True, help='папка с картинками')
    ap.add_argument('--config', required=True, help='XML-конфиг разметки')
    ap.add_argument('--out', required=True, help='папка датасета на выходе')
    ap.add_argument('--val', type=float, default=0.15, help='доля валидации (0.15)')
    args = ap.parse_args()

    value_to_cat, names = parse_config(Path(args.config).read_text(encoding='utf-8'))
    tasks = json.loads(Path(args.json).read_text(encoding='utf-8'))
    if isinstance(tasks, dict):
        tasks = tasks.get('tasks') or []
    index = build_index(Path(args.images))
    out = Path(args.out)

    items = []          # (img_path, [строки label])
    missing = []
    unknown_labels = {}
    total_boxes = 0

    for task in tasks:
        image_ref = str((task.get('data') or {}).get('image') or '')
        img = find_image(index, image_ref) if image_ref else None
        if img is None:
            missing.append(unquote(image_ref.split('/')[-1]))
            continue
        anns = task.get('annotations') or []
        results = (anns[0].get('result') if anns else None) or []
        lines = []
        for r in results:
            if r.get('type') != 'rectanglelabels':
                continue
            v = r.get('value') or {}
            labels = v.get('rectanglelabels') or []
            if not labels:
                continue
            cat = value_to_cat.get(labels[0])
            if cat is None:
                unknown_labels[labels[0]] = unknown_labels.get(labels[0], 0) + 1
                continue
            # LS: проценты левого верхнего угла → YOLO: доли центра
            x, y = float(v.get('x', 0)) / 100, float(v.get('y', 0)) / 100
            w, h = float(v.get('width', 0)) / 100, float(v.get('height', 0)) / 100
            if w <= 0 or h <= 0:
                continue
            lines.append(f'{cat} {x + w / 2:.6f} {y + h / 2:.6f} {w:.6f} {h:.6f}')
            total_boxes += 1
        if lines:
            items.append((img, lines))

    if not items:
        sys.exit('Не собралось ни одной размеченной картинки — проверьте пути и JSON')

    random.Random(42).shuffle(items)
    n_val = max(1, round(len(items) * args.val)) if len(items) > 3 else 0
    splits = {'val': items[:n_val], 'train': items[n_val:]}

    for split, rows in splits.items():
        (out / 'images' / split).mkdir(parents=True, exist_ok=True)
        (out / 'labels' / split).mkdir(parents=True, exist_ok=True)
        for img, lines in rows:
            shutil.copy2(img, out / 'images' / split / img.name)
            (out / 'labels' / split / (img.stem + '.txt')).write_text('\n'.join(lines) + '\n', encoding='utf-8')

    # ВАЖНО: `path` не пишем — ultralytics резолвит относительный path от CWD,
    # а без него корректно берёт корнем папку самого data.yaml (переносимо
    # и локально, и в Colab).
    yaml = ['# INDEXALL — датасет из Label Studio (нумерация классов = category)',
            'train: images/train', f"val: images/{'val' if n_val else 'train'}",
            f'nc: {len(names)}', 'names:']
    yaml += [f'  {i}: {n}' for i, n in enumerate(names)]
    (out / 'data.yaml').write_text('\n'.join(yaml) + '\n', encoding='utf-8')
    (out / 'classes.txt').write_text('\n'.join(names) + '\n', encoding='utf-8')

    print(f'Готово: {out}')
    print(f'  картинок: {len(items)} (train {len(splits["train"])}, val {n_val})')
    print(f'  рамок: {total_boxes}')
    if missing:
        print(f'  ! не нашлось картинок для задач: {len(missing)}')
        for name in missing[:8]:
            print(f'    - {name}')
    if unknown_labels:
        print(f'  ! метки вне конфига (пропущены): {unknown_labels}')
    print('\nОбучение:')
    print(f'  yolo detect train data={out}/data.yaml model=yolov8s.pt epochs=150 imgsz=1280 batch=8')


if __name__ == '__main__':
    main()
