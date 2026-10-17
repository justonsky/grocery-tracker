"""Tests for merge_named_items.py's plan (no server needed).

    cd tools/seed && python3 -m unittest test_merge_named_items
"""
import unittest

from merge_named_items import plan


def item(id_, name):
    return {'id': id_, 'name': name, 'defaultCategoryId': None}


class PlanTests(unittest.TestCase):
    def test_merges_into_an_existing_clean_item_renames_otherwise_and_ignores_the_rest(self):
        items = [item('a', 'Premium Fuji Apples (2 pks)'), item('b', 'Premium Fuji Apples'),
                 item('c', '1 lb Dietz & Watson Roast Beef'), item('d', 'Water'), item('e', 'Indian Mangoes (6 pack)')]
        lines = {'a': [{'quantity': 2, 'unit': 'each'}], 'c': [{'quantity': 1, 'unit': 'lb'}]}
        actions, skipped = plan(items, lambda i: lines.get(i, []))
        self.assertEqual([(k, s['name'], t['name'] if k == 'merge' else t) for k, s, t in actions], [
            ('rename', '1 lb Dietz & Watson Roast Beef', 'Dietz & Watson Roast Beef'),
            ('merge', 'Premium Fuji Apples (2 pks)', 'Premium Fuji Apples'),
        ])
        self.assertEqual(skipped, [])

    def test_twins_without_a_clean_item_become_one(self):
        items = [item('a', 'Premium Fuji Apples (2 packs)'), item('b', 'Premium Fuji Apples (2 pks)')]
        lines = {'a': [{'quantity': 2, 'unit': 'each'}], 'b': [{'quantity': 2, 'unit': 'each'}]}
        actions, _ = plan(items, lambda i: lines[i])
        self.assertEqual([k for k, _, _ in actions], ['rename', 'merge'])
        self.assertEqual(actions[1][2]['id'], 'a')  # the second merges into the first, now renamed

    def test_skips_items_whose_records_dont_carry_the_amount_yet(self):
        items = [item('a', 'Strawberries (2 pks)'), item('b', 'Strawberries')]
        actions, skipped = plan(items, lambda i: [{'quantity': 1, 'unit': 'each'}])
        self.assertEqual(actions, [])
        self.assertIn('run backfill_quantities.py first', skipped[0][2])


if __name__ == '__main__':
    unittest.main()
