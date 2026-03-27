from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

try:
    import sign_language_translator as slt
except Exception as exc:  # pragma: no cover - optional dependency / unsupported Python
    slt = None
    SLT_IMPORT_ERROR = str(exc)
else:
    SLT_IMPORT_ERROR = None


BASE_DIR = Path(__file__).resolve().parent
MEDIA_DIR = BASE_DIR / "media" / "asl"
DEFAULT_FALLBACK_UNIT_MS = 1100
DEFAULT_CLIP_UNIT_MS = 1800
WORD_PATTERN = re.compile(r"[a-z0-9']+")


STOPWORDS = {
    "a",
    "an",
    "am",
    "are",
    "be",
    "for",
    "i",
    "is",
    "it",
    "me",
    "my",
    "of",
    "the",
    "to",
    "we",
    "you",
    "your",
}

URGENT_IDS = {
    "STOP",
    "WAIT",
    "EMERGENCY",
    "CALL-911",
}


EXACT_PHRASE_LIBRARY = {
    "hello": "HELLO",
    "hi": "HELLO",
    "good morning": "GOOD-MORNING",
    "good afternoon": "GOOD-AFTERNOON",
    "good evening": "GOOD-EVENING",
    "goodbye": "GOODBYE",
    "bye": "GOODBYE",
    "thank you": "THANK-YOU",
    "thanks": "THANK-YOU",
    "please": "PLEASE",
    "nice to meet you": "NICE-TO-MEET-YOU",
    "how are you": "HOW-ARE-YOU",
    "i am fine": "I-AM-FINE",
    "can you hear me": "CAN-YOU-HEAR-ME",
    "can you see me": "CAN-YOU-SEE-ME",
    "can you repeat that": "CAN-YOU-REPEAT-THAT",
    "please repeat that": "PLEASE-REPEAT-THAT",
    "please slow down": "PLEASE-SLOW-DOWN",
    "please speak slowly": "PLEASE-SPEAK-SLOWLY",
    "please sign slowly": "PLEASE-SIGN-SLOWLY",
    "i do not understand": "I-DO-NOT-UNDERSTAND",
    "i understand": "I-UNDERSTAND",
    "one moment": "ONE-MOMENT",
    "please wait": "PLEASE-WAIT",
    "wait a moment": "PLEASE-WAIT",
    "hold on": "PLEASE-WAIT",
    "stop": "STOP",
    "wait": "WAIT",
    "yes": "YES",
    "no": "NO",
    "maybe": "MAYBE",
    "okay": "OKAY",
    "ok": "OKAY",
    "welcome": "WELCOME",
    "excuse me": "EXCUSE-ME",
    "sorry": "SORRY",
    "what is your name": "WHAT-YOUR-NAME",
    "my name is": "MY-NAME",
    "what time is it": "WHAT-TIME",
    "see you later": "SEE-YOU-LATER",
    "see you tomorrow": "SEE-YOU-TOMORROW",
    "good job": "GOOD-JOB",
    "good work": "GOOD-WORK",
    "well done": "GOOD-JOB",
    "i need help": "I-NEED-HELP",
    "do you need help": "YOU-NEED-HELP",
    "i need an interpreter": "I-NEED-INTERPRETER",
    "call 911": "CALL-911",
    "emergency": "EMERGENCY",
    "meeting starts now": "MEETING-START-NOW",
    "the meeting starts now": "MEETING-START-NOW",
    "meeting is over": "MEETING-FINISH",
    "the meeting is over": "MEETING-FINISH",
    "can we start": "CAN-WE-START",
    "lets start": "START",
    "let us start": "START",
    "please join the meeting": "PLEASE-JOIN-MEETING",
    "please mute your microphone": "PLEASE-MUTE-MIC",
    "please unmute your microphone": "PLEASE-UNMUTE-MIC",
    "please turn on your camera": "PLEASE-CAMERA-ON",
    "please turn off your camera": "PLEASE-CAMERA-OFF",
    "i am sharing my screen": "I-SHARE-SCREEN",
    "can you share your screen": "CAN-YOU-SHARE-SCREEN",
    "i sent the file": "I-SENT-FILE",
    "please check the chat": "PLEASE-CHECK-CHAT",
    "i will send an email": "I-SEND-EMAIL",
    "can you send the link": "CAN-YOU-SEND-LINK",
    "what is the deadline": "WHAT-DEADLINE",
    "the deadline is tomorrow": "DEADLINE-TOMORROW",
    "the deadline is today": "DEADLINE-TODAY",
    "the deadline is next week": "DEADLINE-NEXT-WEEK",
    "i will be late": "I-LATE",
    "i am late": "I-LATE",
    "i am early": "I-EARLY",
    "i am ready": "I-READY",
    "are you ready": "YOU-READY",
    "i am not ready": "I-NOT-READY",
    "can you help me": "CAN-YOU-HELP-ME",
    "please write it down": "PLEASE-WRITE-DOWN",
    "please type it in the chat": "PLEASE-TYPE-CHAT",
    "do you understand": "YOU-UNDERSTAND",
    "i will call you later": "I-CALL-YOU-LATER",
    "the audio is not working": "AUDIO-NOT-WORK",
    "the video is not working": "VIDEO-NOT-WORK",
    "the connection is bad": "CONNECTION-BAD",
    "the internet is slow": "INTERNET-SLOW",
    "can you join again": "CAN-YOU-REJOIN",
    "please join again": "PLEASE-REJOIN",
    "one second": "ONE-SECOND",
    "one minute": "ONE-MINUTE",
    "i am here": "I-HERE",
    "are you here": "YOU-HERE",
    "i am at work": "I-AT-WORK",
    "i am at home": "I-AT-HOME",
    "what day is today": "WHAT-DAY-TODAY",
    "today is monday": "TODAY-MONDAY",
    "today is tuesday": "TODAY-TUESDAY",
    "today is wednesday": "TODAY-WEDNESDAY",
    "today is thursday": "TODAY-THURSDAY",
    "today is friday": "TODAY-FRIDAY",
    "today is saturday": "TODAY-SATURDAY",
    "today is sunday": "TODAY-SUNDAY",
    "thank you for your time": "THANK-YOU-TIME",
    "please let me know": "PLEASE-LET-ME-KNOW",
    "can you clarify": "CAN-YOU-CLARIFY",
    "please clarify": "PLEASE-CLARIFY",
    "do you have questions": "YOU-HAVE-QUESTIONS",
    "i have a question": "I-HAVE-QUESTION",
    "any questions": "ANY-QUESTIONS",
}

UNIT_LIBRARY = {
    "afternoon": "AFTERNOON",
    "again": "AGAIN",
    "audio": "AUDIO",
    "bad": "BAD",
    "call": "CALL",
    "camera": "CAMERA",
    "chat": "CHAT",
    "check": "CHECK",
    "clarify": "CLARIFY",
    "connection": "CONNECTION",
    "deadline": "DEADLINE",
    "email": "EMAIL",
    "finish": "FINISH",
    "file": "FILE",
    "good": "GOOD",
    "hear": "HEAR",
    "help": "HELP",
    "home": "HOME",
    "internet": "INTERNET",
    "join": "JOIN",
    "later": "LATER",
    "link": "LINK",
    "meeting": "MEETING",
    "microphone": "MICROPHONE",
    "minute": "MINUTE",
    "moment": "MOMENT",
    "morning": "MORNING",
    "mute": "MUTE",
    "name": "NAME",
    "need": "NEED",
    "question": "QUESTION",
    "questions": "QUESTIONS",
    "ready": "READY",
    "repeat": "REPEAT",
    "screen": "SCREEN",
    "second": "SECOND",
    "see": "SEE",
    "send": "SEND",
    "share": "SHARE",
    "sign": "SIGN",
    "slow": "SLOW",
    "slowly": "SLOW",
    "sorry": "SORRY",
    "speak": "SPEAK",
    "start": "START",
    "stop": "STOP",
    "thank": "THANK",
    "thanks": "THANK-YOU",
    "time": "TIME",
    "today": "TODAY",
    "tomorrow": "TOMORROW",
    "turn": "TURN",
    "understand": "UNDERSTAND",
    "unmute": "UNMUTE",
    "video": "VIDEO",
    "wait": "WAIT",
    "welcome": "WELCOME",
    "work": "WORK",
    "write": "WRITE",
    "yes": "YES",
    "no": "NO",
}

DAY_LIBRARY = {
    "monday": "MONDAY",
    "tuesday": "TUESDAY",
    "wednesday": "WEDNESDAY",
    "thursday": "THURSDAY",
    "friday": "FRIDAY",
    "saturday": "SATURDAY",
    "sunday": "SUNDAY",
}

DIGIT_LIBRARY = {str(value): f"NUM-{value}" for value in range(10)}
MAX_NGRAM = max(len(key.split()) for key in EXACT_PHRASE_LIBRARY)


@dataclass(frozen=True)
class Unit:
    type: str
    id: str
    duration_ms: int
    text: str | None = None
    url: str | None = None

    def as_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {
            "type": self.type,
            "id": self.id,
            "duration_ms": self.duration_ms,
        }
        if self.text:
            payload["text"] = self.text
        if self.url:
            payload["url"] = self.url
        return payload


def normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[\u2018\u2019]", "'", lowered)
    lowered = re.sub(r"[^a-z0-9?!,.;:'\s-]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def split_clauses(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    segments = re.split(r"[?!,.;:]+", normalized)
    return [segment.strip() for segment in segments if segment.strip()]


def tokenize(segment: str) -> list[str]:
    return WORD_PATTERN.findall(segment)


def slugify(value: str) -> str:
    return value.lower().replace("_", "-")


def clip_url(base_url: str, unit_id: str, bucket: str) -> str | None:
    relative = Path(bucket) / f"{slugify(unit_id)}.mp4"
    candidate = MEDIA_DIR / relative
    if not candidate.exists():
        return None
    base = base_url.rstrip("/")
    return f"{base}/media/asl/{relative.as_posix()}"


def clip_unit(
    base_url: str,
    unit_id: str,
    bucket: str = "phrases",
    text: str | None = None,
    duration_ms: int = DEFAULT_CLIP_UNIT_MS,
) -> Unit:
    return Unit(
        type="clip",
        id=unit_id,
        duration_ms=duration_ms,
        text=text,
        url=clip_url(base_url, unit_id, bucket),
    )


def fingerspell_units(word: str, base_url: str) -> list[Unit]:
    units: list[Unit] = []
    for character in word.upper():
        if "A" <= character <= "Z":
            units.append(
                Unit(
                    type="clip",
                    id=f"FS-{character}",
                    duration_ms=850,
                    text=character,
                    url=clip_url(base_url, f"FS-{character}", "fingerspelling"),
                )
            )
        elif character.isdigit():
            units.append(clip_unit(base_url, DIGIT_LIBRARY[character], "numbers", text=character, duration_ms=850))
    return units


def token_to_units(token: str, base_url: str) -> list[Unit]:
    if token in DAY_LIBRARY:
        return [clip_unit(base_url, DAY_LIBRARY[token], "days", text=token)]
    if token in DIGIT_LIBRARY:
        return [clip_unit(base_url, DIGIT_LIBRARY[token], "numbers", text=token, duration_ms=900)]
    if token in UNIT_LIBRARY:
        return [clip_unit(base_url, UNIT_LIBRARY[token], "phrases", text=token)]
    if token in STOPWORDS:
        return []
    return fingerspell_units(token, base_url)


def exact_phrase_units(segment: str, base_url: str) -> list[Unit] | None:
    unit_id = EXACT_PHRASE_LIBRARY.get(segment)
    if not unit_id:
        return None
    return [clip_unit(base_url, unit_id, "phrases", text=segment)]


def compose_tokens(tokens: list[str], base_url: str) -> list[Unit]:
    if not tokens:
        return []

    units: list[Unit] = []
    cursor = 0
    while cursor < len(tokens):
        matched = False
        remaining = len(tokens) - cursor
        for window in range(min(MAX_NGRAM, remaining), 0, -1):
            candidate = " ".join(tokens[cursor:cursor + window])
            exact_units = exact_phrase_units(candidate, base_url)
            if exact_units:
                units.extend(exact_units)
                cursor += window
                matched = True
                break

        if matched:
            continue

        units.extend(token_to_units(tokens[cursor], base_url))
        cursor += 1

    return units


def compose_segment(segment: str, base_url: str) -> list[Unit]:
    return compose_tokens(tokenize(segment), base_url)


def detect_mode(units: Iterable[Unit]) -> str:
    unit_ids = [unit.id for unit in units]
    if unit_ids and all(unit_id.startswith("FS-") for unit_id in unit_ids):
        return "fingerspell"
    if any(unit_id.startswith("FS-") for unit_id in unit_ids):
        return "mixed"
    return "clips"


def is_urgent(units: Iterable[Unit]) -> bool:
    return any(unit.id in URGENT_IDS for unit in units)


def fallback_plan(text: str, base_url: str) -> tuple[list[Unit], dict[str, object]]:
    segments = split_clauses(text)
    units: list[Unit] = []

    for segment in segments:
        exact_units = exact_phrase_units(segment, base_url)
        if exact_units:
            units.extend(exact_units)
            continue
        units.extend(compose_segment(segment, base_url))

    metadata = {
        "provider": "fallback",
        "provider_available": True,
        "provider_reason": "built-in-signflow-planner",
    }
    return units, metadata


def _token_from_slt_token(token: object) -> str:
    if token is None:
        return ""
    if isinstance(token, str):
        return token
    return str(token)


def _slt_tokens_for_text(text: str) -> list[str]:
    if slt is None:
        raise RuntimeError(SLT_IMPORT_ERROR or "sign-language-translator is not available")

    english = slt.languages.text.English()
    normalized = english.preprocess(text)
    raw_sentences = english.sentence_tokenize(normalized)
    collected: list[str] = []

    for sentence in raw_sentences:
        sentence_text = _token_from_slt_token(sentence)
        sentence_tokens = english.tokenize(sentence_text)
        cleaned_tokens = [
            token.lower()
            for token in (_token_from_slt_token(item) for item in sentence_tokens)
            if WORD_PATTERN.fullmatch(token.lower())
        ]
        collected.extend(cleaned_tokens)

    return collected


def slt_plan(text: str, base_url: str) -> tuple[list[Unit], dict[str, object]]:
    segments = split_clauses(text)
    units: list[Unit] = []

    for segment in segments:
        exact_units = exact_phrase_units(segment, base_url)
        if exact_units:
            units.extend(exact_units)
            continue

        tokens = _slt_tokens_for_text(segment)
        units.extend(compose_tokens(tokens, base_url))

    metadata = {
        "provider": "sign-language-translator",
        "provider_available": True,
        "provider_reason": "english-tokenization-and-segmentation",
        "provider_import_error": None,
    }
    return units, metadata


def select_provider() -> str:
    configured = os.getenv("SIGNFLOW_SIGN_PROVIDER", "auto").strip().lower()
    if configured in {"fallback", "builtin"}:
        return "fallback"
    if configured in {"slt", "sign-language-translator"}:
        return "slt"
    return "auto"


def build_sign_plan(text: str, base_url: str) -> dict[str, object]:
    provider_choice = select_provider()
    metadata: dict[str, object]

    if provider_choice == "slt":
        try:
            units, metadata = slt_plan(text, base_url)
        except Exception as exc:
            units, metadata = fallback_plan(text, base_url)
            metadata.update({
                "provider_requested": "sign-language-translator",
                "provider_available": False,
                "provider_error": str(exc),
            })
    elif provider_choice == "auto" and slt is not None:
        try:
            units, metadata = slt_plan(text, base_url)
        except Exception as exc:
            units, metadata = fallback_plan(text, base_url)
            metadata.update({
                "provider_requested": "auto",
                "provider_available": False,
                "provider_error": str(exc),
            })
    else:
        units, metadata = fallback_plan(text, base_url)
        if provider_choice == "auto":
            metadata.update({
                "provider_requested": "auto",
                "provider_available": False if slt is None else True,
                "provider_error": SLT_IMPORT_ERROR,
            })

    if not units:
        units = [Unit(type="card", id="NO-SIGN-PLAN", duration_ms=DEFAULT_FALLBACK_UNIT_MS, text="No sign plan available")]

    return {
        "text": text.strip(),
        "sign_language": "ASL",
        "mode": detect_mode(units),
        "priority": "urgent" if is_urgent(units) else "normal",
        "units": [unit.as_dict() for unit in units],
        **metadata,
    }
