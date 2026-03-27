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
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "FS-H",
            "FS-O",
            "FS-W",
            "FS-A",
            "FS-R",
            "FS-E",
            "FS-Y",
            "FS-O",
            "FS-U",
        ])

    def test_single_word_phrase_prefers_phrase_sign(self):
        plan = build_sign_plan("Hello", "http://localhost:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual([unit["id"] for unit in plan["units"]], ["HELLO"])

    def test_unknown_word_uses_fingerspelling(self):
        plan = build_sign_plan("dashboard", "http://localhost:8001")
        self.assertEqual(plan["mode"], "fingerspell")
        self.assertEqual(plan["card_count"], 0)
        self.assertEqual(plan["fingerspell_count"], 9)
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "FS-D",
            "FS-A",
            "FS-S",
            "FS-H",
            "FS-B",
            "FS-O",
            "FS-A",
            "FS-R",
            "FS-D",
        ])

    def test_name_phrase_is_fingerspelled(self):
        plan = build_sign_plan("My name is Maya", "http://localhost:8001")
        self.assertEqual(plan["mode"], "fingerspell")
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "FS-M",
            "FS-Y",
            "FS-N",
            "FS-A",
            "FS-M",
            "FS-E",
            "FS-I",
            "FS-S",
            "FS-M",
            "FS-A",
            "FS-Y",
            "FS-A",
        ])

    def test_acronym_is_fingerspelled(self):
        plan = build_sign_plan("ASL", "http://localhost:8001")
        self.assertEqual(plan["mode"], "fingerspell")
        self.assertEqual([unit["id"] for unit in plan["units"]], ["FS-A", "FS-S", "FS-L"])

    def test_mixed_sentence_is_fingerspelled(self):
        plan = build_sign_plan("Please meet Maya", "http://localhost:8001")
        self.assertEqual(plan["mode"], "fingerspell")
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "FS-P",
            "FS-L",
            "FS-E",
            "FS-A",
            "FS-S",
            "FS-E",
            "FS-M",
            "FS-E",
            "FS-E",
            "FS-T",
            "FS-M",
            "FS-A",
            "FS-Y",
            "FS-A",
        ])

    def test_urgent_phrase_is_prioritized(self):
        plan = build_sign_plan("Stop", "http://localhost:8001")
        self.assertEqual(plan["priority"], "urgent")

    def test_provider_metadata_is_present(self):
        plan = build_sign_plan("Hello", "http://localhost:8001")
        self.assertIn("provider", plan)
        self.assertIn("provider_available", plan)
        self.assertEqual(plan["fallback_strategy"], "word-first-name-fingerspell")


if __name__ == "__main__":
    unittest.main()
