import unittest

from planner import build_sign_plan


class PlannerTests(unittest.TestCase):
    def test_exact_phrase_returns_clip(self):
        plan = build_sign_plan("Can you repeat that?", "http://localhost:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual(plan["units"][0]["id"], "CAN-YOU-REPEAT-THAT")

    def test_unknown_word_fingerspells(self):
        plan = build_sign_plan("Maya", "http://localhost:8001")
        self.assertEqual(plan["mode"], "fingerspell")
        self.assertEqual([unit["id"] for unit in plan["units"]], ["FS-M", "FS-A", "FS-Y", "FS-A"])

    def test_single_word_phrase_prefers_phrase_sign(self):
        plan = build_sign_plan("Hello", "http://localhost:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual([unit["id"] for unit in plan["units"]], ["HELLO"])

    def test_urgent_phrase_is_prioritized(self):
        plan = build_sign_plan("Stop", "http://localhost:8001")
        self.assertEqual(plan["priority"], "urgent")

    def test_provider_metadata_is_present(self):
        plan = build_sign_plan("Hello", "http://localhost:8001")
        self.assertIn("provider", plan)
        self.assertIn("provider_available", plan)


if __name__ == "__main__":
    unittest.main()
