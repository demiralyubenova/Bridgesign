import unittest

from planner import build_sign_plan


class PlannerTests(unittest.TestCase):
    def test_phrase_uses_word_videos_and_letter_fallback(self):
        plan = build_sign_plan("How are you", "http://127.0.0.1:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "DATASET-HOW",
            "DATASET-A",
            "DATASET-R",
            "DATASET-E",
            "DATASET-YOU",
        ])
        self.assertEqual(plan["units"][0]["url"], "http://127.0.0.1:8001/signs-data/signer_5/00215_how_28212.f398.mp4")
        self.assertEqual(plan["units"][-1]["url"], "http://127.0.0.1:8001/signs-data/signer_5/00381_you_64386.f136.mp4")

    def test_known_word_prefers_dataset_clip(self):
        plan = build_sign_plan("Hello", "http://127.0.0.1:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual([unit["id"] for unit in plan["units"]], ["DATASET-HELLO"])
        self.assertEqual(plan["units"][0]["url"], "http://127.0.0.1:8001/signs-data/signer_9/00342_hello_27171.mp4")

    def test_unknown_word_uses_letter_videos(self):
        plan = build_sign_plan("dashboard", "http://127.0.0.1:8001")
        self.assertEqual(plan["mode"], "clips")
        self.assertEqual(plan["card_count"], 0)
        self.assertEqual(plan["fingerspell_count"], 0)
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "DATASET-D",
            "DATASET-A",
            "DATASET-S",
            "DATASET-H",
            "DATASET-B",
            "DATASET-O",
            "DATASET-A",
            "DATASET-R",
            "DATASET-D",
        ])

    def test_name_phrase_uses_word_and_letter_videos(self):
        plan = build_sign_plan("My name is Maya", "http://127.0.0.1:8001")
        self.assertEqual(plan["mode"], "mixed")
        self.assertEqual([unit["id"] for unit in plan["units"]], [
            "DATASET-MY",
            "DATASET-NAME",
            "DATASET-I",
            "DATASET-S",
            "DATASET-M",
            "DATASET-A",
            "FS-Y",
            "DATASET-A",
        ])

    def test_urgent_phrase_is_prioritized(self):
        plan = build_sign_plan("Stop", "http://127.0.0.1:8001")
        self.assertEqual(plan["priority"], "urgent")

    def test_provider_metadata_is_present(self):
        plan = build_sign_plan("Hello", "http://127.0.0.1:8001")
        self.assertIn("provider", plan)
        self.assertIn("provider_available", plan)
        self.assertEqual(plan["fallback_strategy"], "signs-data-word-sequence")


if __name__ == "__main__":
    unittest.main()
