"""Merge items whose names still carry an amount into the item without it.

    python3 merge_named_items.py --server http://<host>:5080            # dry run: list what would change
    python3 merge_named_items.py --server http://<host>:5080 --apply    # do it

A database seeded before quantities existed has items like "Premium Fuji Apples (2 pks)" or
"1 lb Dietz & Watson Roast Beef". backfill_quantities.py moves the amount onto each line (2 each,
1 lb) but leaves those items next to "Premium Fuji Apples" / "Dietz & Watson Roast Beef". This
finishes the job through the running server's own Items-page actions:

  - an item with the clean name exists -> merge into it (records, recipes, dashboard pins and
    receipt names all move; the old item is deleted once empty);
  - otherwise -> rename the item to the clean name.

Only items whose every record already carries the amount from its name are touched (run the
backfill first); anything else is listed and skipped. Back up the data folder before --apply.
Stdlib only; the server must be running.
"""
import argparse, json, pathlib, sys, urllib.error, urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import extract  # noqa: E402


def norm(name):
    return name.strip().lower()  # the app's NameNormalizer


def plan(items, lines_of):
    """[(action, item, target_name_or_item, reason)] for items named with an amount.

    items: [{'id','name','defaultCategoryId'}]; lines_of(item_id) -> [{'quantity','unit'}].
    """
    by_name = {norm(i['name']): i for i in items}
    actions, skipped = [], []
    for item in sorted(items, key=lambda i: i['name'].lower()):
        clean, qty, unit = extract.clean_name(item['name'])
        if not clean or norm(clean) == norm(item['name']) or (qty == 1 and unit == 'each'):
            continue
        lines = lines_of(item['id'])
        if any((float(l.get('quantity', 1)), l.get('unit', 'each')) != (float(qty), unit) for l in lines):
            skipped.append((item, clean, f'its records aren\'t all {qty:g} {unit} yet — run backfill_quantities.py first'))
            continue
        target = by_name.get(norm(clean))
        if target is not None and target['id'] != item['id']:
            actions.append(('merge', item, target))
        else:
            actions.append(('rename', item, clean))
            renamed = dict(item, name=clean)
            by_name[norm(clean)] = renamed  # a later "(2 pks)" twin merges into this one
    return actions, skipped


class Server:
    def __init__(self, base):
        self.base = base.rstrip('/') + '/api/v1'

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read()
            return json.loads(text) if text else None


def main(argv=None, server=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--server', required=True, help='e.g. http://192.168.1.20:5080')
    ap.add_argument('--apply', action='store_true', help='make the changes (default: list only)')
    args = ap.parse_args(argv)
    server = server or Server(args.server)
    try:
        items = server.call('GET', '/catalog/items')
    except (urllib.error.URLError, OSError) as e:
        sys.exit(f'Could not reach the server at {args.server}: {e}')

    actions, skipped = plan(items, lambda item_id: server.call('GET', f'/items/{item_id}/lines'))
    merges = [a for a in actions if a[0] == 'merge']
    print(f'{len(actions)} items to fix: {len(merges)} merged into an existing item, {len(actions) - len(merges)} renamed; {len(skipped)} skipped.')
    for kind, item, target in actions:
        print(f'   {kind:6} "{item["name"]}" -> "{target["name"] if kind == "merge" else target}"')
    for item, clean, why in skipped:
        print(f'   skip   "{item["name"]}" ({why})')
    if not args.apply:
        print('\nDry run — nothing changed. Back up the data folder, then re-run with --apply.')
        return 0

    done = 0
    for kind, item, target in actions:
        try:
            if kind == 'merge':
                server.call('POST', f'/items/{item["id"]}/merge', {'targetItemId': target['id'], 'storeName': None, 'deleteSourceIfEmpty': True})
            else:
                # A rename can find the name taken by an item renamed earlier in this run: merge instead.
                current = {norm(i['name']): i for i in server.call('GET', '/catalog/items')}
                existing = current.get(norm(target))
                if existing is not None and existing['id'] != item['id']:
                    server.call('POST', f'/items/{item["id"]}/merge', {'targetItemId': existing['id'], 'storeName': None, 'deleteSourceIfEmpty': True})
                else:
                    server.call('PUT', f'/items/{item["id"]}', {'name': target, 'defaultCategoryId': item.get('defaultCategoryId')})
            done += 1
        except urllib.error.HTTPError as e:
            print(f'   failed "{item["name"]}": {e.code} {e.read().decode(errors="replace")[:200]}')
    print(f'\nFixed {done} of {len(actions)} items.')
    return 0


if __name__ == '__main__':
    main()
