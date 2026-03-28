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
SIGNS_DATA_DIR = BASE_DIR.parent / "signs_data"
DEFAULT_FALLBACK_UNIT_MS = 1100
DEFAULT_CLIP_UNIT_MS = 1800
WORD_PATTERN = re.compile(r"[a-z0-9']+")
SOURCE_WORD_PATTERN = re.compile(r"[A-Za-z0-9']+")


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

SPELL_INTENT_TOKENS = {
    "initial",
    "initials",
    "letter",
    "letters",
    "spell",
    "spelled",
    "spelling",
}

NAME_INTRO_PATTERNS = (
    ("my", "name", "is"),
    ("this", "is"),
    ("meet",),
)


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
    # ---- Emotions / social ----
    "i love you": "I-LOVE-YOU",
    "i miss you": "I-MISS-YOU",
    "congratulations": "CONGRATULATIONS",
    "happy birthday": "HAPPY-BIRTHDAY",
    "take care": "TAKE-CARE",
    "have a good day": "HAVE-GOOD-DAY",
    "have a nice day": "HAVE-GOOD-DAY",
    "nice job": "GOOD-JOB",
    "i am happy": "I-HAPPY",
    "i am sad": "I-SAD",
    "i am tired": "I-TIRED",
    "i am busy": "I-BUSY",
    "i am sick": "I-SICK",
    "i am sorry": "I-SORRY",
    "no problem": "NO-PROBLEM",
    "no worries": "NO-PROBLEM",
    "of course": "OF-COURSE",
    "i agree": "I-AGREE",
    "i disagree": "I-DISAGREE",
    "what happened": "WHAT-HAPPENED",
    "where are you": "WHERE-YOU",
    "i am coming": "I-COME",
    "come here": "COME-HERE",
    "go ahead": "GO-AHEAD",
    "be careful": "CAREFUL",
    "never mind": "NEVER-MIND",
    "i forgot": "I-FORGET",
}

UNIT_LIBRARY = {
    # ---- Existing entries ----
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
    # ---- Common verbs ----
    "go": "GO",
    "come": "COME",
    "give": "GIVE",
    "take": "TAKE",
    "make": "MAKE",
    "want": "WANT",
    "like": "LIKE",
    "love": "LOVE",
    "know": "KNOW",
    "think": "THINK",
    "tell": "TELL",
    "ask": "ASK",
    "try": "TRY",
    "run": "RUN",
    "walk": "WALK",
    "sit": "SIT",
    "stand": "STAND",
    "eat": "EAT",
    "drink": "DRINK",
    "sleep": "SLEEP",
    "play": "PLAY",
    "read": "READ",
    "learn": "LEARN",
    "teach": "TEACH",
    "show": "SHOW",
    "open": "OPEN",
    "close": "CLOSE",
    "drive": "DRIVE",
    "dance": "DANCE",
    "cook": "COOK",
    "buy": "BUY",
    "bring": "BRING",
    "feel": "FEEL",
    "find": "FIND",
    "forget": "FORGET",
    "keep": "KEEP",
    "leave": "LEAVE",
    "listen": "LISTEN",
    "look": "LOOK",
    "put": "PUT",
    "talk": "TALK",
    "use": "USE",
    "pay": "PAY",
    "cry": "CRY",
    "laugh": "LAUGH",
    "smile": "SMILE",
    "have": "HAVE",
    "live": "LIVE",
    # ---- Common adjectives ----
    "happy": "HAPPY",
    "sad": "SAD",
    "angry": "ANGRY",
    "beautiful": "BEAUTIFUL",
    "big": "BIG",
    "small": "SMALL",
    "hot": "HOT",
    "cold": "COLD",
    "fast": "FAST",
    "far": "FAR",
    "near": "NEAR",
    "new": "NEW",
    "old": "OLD",
    "nice": "NICE",
    "great": "GREAT",
    "important": "IMPORTANT",
    "different": "DIFFERENT",
    "right": "RIGHT",
    "wrong": "WRONG",
    "hard": "HARD",
    "easy": "EASY",
    "strong": "STRONG",
    "hungry": "HUNGRY",
    "rich": "RICH",
    "poor": "POOR",
    "short": "SHORT",
    "long": "LONG",
    "young": "YOUNG",
    # ---- Common nouns ----
    "people": "PEOPLE",
    "man": "MAN",
    "woman": "WOMAN",
    "boy": "BOY",
    "girl": "GIRL",
    "baby": "BABY",
    "children": "CHILDREN",
    "mother": "MOTHER",
    "father": "FATHER",
    "brother": "BROTHER",
    "sister": "SISTER",
    "son": "SON",
    "friend": "FRIEND",
    "family": "FAMILY",
    "teacher": "TEACHER",
    "doctor": "DOCTOR",
    "house": "HOUSE",
    "room": "ROOM",
    "door": "DOOR",
    "car": "CAR",
    "city": "CITY",
    "school": "SCHOOL",
    "food": "FOOD",
    "water": "WATER",
    "book": "BOOK",
    "money": "MONEY",
    "music": "MUSIC",
    "movie": "MOVIE",
    "animal": "ANIMAL",
    "dog": "DOG",
    "cat": "CAT",
    "word": "WORD",
    "story": "STORY",
    "language": "LANGUAGE",
    "place": "PLACE",
    "job": "JOB",
    "life": "LIFE",
    "world": "WORLD",
    "night": "NIGHT",
    "evening": "EVENING",
    "day": "DAY",
    "week": "WEEK",
    "month": "MONTH",
    "year": "YEAR",
    # ---- Other common words ----
    "about": "ABOUT",
    "after": "AFTER",
    "all": "ALL",
    "also": "ALSO",
    "always": "ALWAYS",
    "before": "BEFORE",
    "down": "DOWN",
    "up": "UP",
    "here": "HERE",
    "there": "THERE",
    "now": "NOW",
    "never": "NEVER",
    "every": "EVERY",
    "each": "EACH",
    "more": "MORE",
    "many": "MANY",
    "much": "MUCH",
    "some": "SOME",
    "thing": "THING",
    "something": "SOMETHING",
    "nothing": "NOTHING",
    "please": "PLEASE",
    "hello": "HELLO",
    "goodbye": "GOODBYE",
    "excuse": "EXCUSE",
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
TOKEN_ALIAS_LIBRARY = {
    "ok": "OKAY",
    "okay": "OKAY",
    "thanks": "THANK-YOU",
}


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


@dataclass(frozen=True)
class SourceToken:
    original: str
    normalized: str


@dataclass(frozen=True)
class DatasetClip:
    lemma: str
    path: Path


def normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[\u2018\u2019]", "'", lowered)
    lowered = re.sub(r"[^a-z0-9?!,.;:'\s-]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered.strip()


def split_clauses(text: str) -> list[tuple[str, str]]:
    segments: list[tuple[str, str]] = []
    for raw_segment in re.split(r"[?!,.;:]+", text):
        original = re.sub(r"\s+", " ", raw_segment).strip()
        normalized = normalize_text(raw_segment)
        if normalized:
            segments.append((original or normalized, normalized))
    return segments


def tokenize(segment: str) -> list[str]:
    return WORD_PATTERN.findall(segment)


def source_tokens(segment: str) -> list[SourceToken]:
    tokens: list[SourceToken] = []
    for match in SOURCE_WORD_PATTERN.finditer(segment):
        original = match.group(0)
        normalized = normalize_text(original)
        if normalized:
            tokens.append(SourceToken(original=original, normalized=normalized))
    return tokens


def slugify(value: str) -> str:
    return value.lower().replace("_", "-")


def _signs_data_key(value: str) -> str:
    return normalize_text(value.replace("_", " "))


def _parse_signs_data_clip(path: Path) -> tuple[str, int, int] | None:
    stem = path.stem
    if "_" not in stem:
        return None

    prefix, _, remaining = stem.partition("_")
    if not prefix.isdigit() or "_" not in remaining:
        return None

    lemma, _, tail = remaining.rpartition("_")
    if not lemma:
        return None

    signer_name = path.parent.name
    try:
        signer_rank = int(signer_name.split("_", 1)[1])
    except (IndexError, ValueError):
        signer_rank = 999

    extension_rank = 0 if path.suffix.lower() == ".mp4" else 1
    return _signs_data_key(lemma), extension_rank, signer_rank


def build_signs_data_index() -> dict[str, list[DatasetClip]]:
    index: dict[str, list[DatasetClip]] = {}
    if not SIGNS_DATA_DIR.exists():
        return index

    candidates: dict[str, list[tuple[int, int, Path]]] = {}
    for path in SIGNS_DATA_DIR.rglob("*"):
        if path.suffix.lower() not in {".mp4", ".webm"}:
            continue
        parsed = _parse_signs_data_clip(path)
        if not parsed:
            continue
        key, extension_rank, signer_rank = parsed
        candidates.setdefault(key, []).append((extension_rank, signer_rank, path))

    for key, options in candidates.items():
        sorted_paths = sorted(options, key=lambda item: (item[0], item[1], str(item[2])))
        index[key] = [
            DatasetClip(lemma=key, path=path)
            for _extension_rank, _signer_rank, path in sorted_paths
        ]

    return index


SIGNS_DATA_INDEX = build_signs_data_index()


def clip_url(base_url: str, unit_id: str, bucket: str) -> str | None:
    relative = Path(bucket) / f"{slugify(unit_id)}.mp4"
    candidate = MEDIA_DIR / relative
    if not candidate.exists():
        return None
    base = base_url.rstrip("/")
    return f"{base}/media/asl/{relative.as_posix()}"


def signs_data_url(base_url: str, clip_path: Path) -> str:
    base = base_url.rstrip("/")
    relative = clip_path.relative_to(SIGNS_DATA_DIR)
    return f"{base}/signs-data/{relative.as_posix()}"


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


def signs_data_unit(base_url: str, clip: DatasetClip, *, text: str | None = None, duration_ms: int = DEFAULT_CLIP_UNIT_MS) -> Unit:
    return Unit(
        type="clip",
        id=f"DATASET-{slugify(clip.lemma).upper()}",
        duration_ms=duration_ms,
        text=text,
        url=signs_data_url(base_url, clip.path),
    )


def card_unit(text: str) -> Unit:
    normalized = normalize_text(text)
    slug = slugify(normalized) if normalized else "unknown-word"
    return Unit(
        type="card",
        id=f"WORD-{slug.upper()}",
        duration_ms=DEFAULT_FALLBACK_UNIT_MS,
        text=text,
    )


def fingerspell_units(word: str, base_url: str) -> list[Unit]:
    units: list[Unit] = []
    for character in word.upper():
        if "A" <= character <= "Z":
            dataset_letter = dataset_token_unit(character.lower(), base_url, text=character)
            if dataset_letter:
                units.append(dataset_letter)
                continue
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


def dataset_clip_for_key(key: str) -> DatasetClip | None:
    matches = SIGNS_DATA_INDEX.get(_signs_data_key(key))
    if not matches:
        return None
    return matches[0]


def dataset_token_unit(token: str, base_url: str, *, text: str) -> Unit | None:
    clip = dataset_clip_for_key(token)
    if not clip:
        return None
    return signs_data_unit(base_url, clip, text=text)


def known_token_unit(token: str, base_url: str, *, text: str) -> Unit | None:
    if token in DAY_LIBRARY:
        return clip_unit(base_url, DAY_LIBRARY[token], "days", text=text)
    if token in DIGIT_LIBRARY:
        return clip_unit(base_url, DIGIT_LIBRARY[token], "numbers", text=text, duration_ms=900)
    if token in UNIT_LIBRARY:
        return clip_unit(base_url, UNIT_LIBRARY[token], "phrases", text=text)
    return None


def alias_token_unit(token: str, base_url: str, *, text: str) -> Unit | None:
    unit_id = TOKEN_ALIAS_LIBRARY.get(token)
    if not unit_id:
        return None
    return clip_unit(base_url, unit_id, "phrases", text=text)


def _append_candidate(candidates: list[str], value: str) -> None:
    if value and value not in candidates:
        candidates.append(value)


def morphology_candidates(token: str) -> list[str]:
    candidates: list[str] = []

    if token.endswith("ies") and len(token) > 3:
        _append_candidate(candidates, token[:-3] + "y")
    if token.endswith("es") and len(token) > 2:
        _append_candidate(candidates, token[:-2])
    if token.endswith("s") and len(token) > 1:
        _append_candidate(candidates, token[:-1])

    if token.endswith("ing") and len(token) > 4:
        stem = token[:-3]
        _append_candidate(candidates, stem)
        if len(stem) > 1 and stem[-1] == stem[-2]:
            _append_candidate(candidates, stem[:-1])
        _append_candidate(candidates, f"{stem}e")

    if token.endswith("ed") and len(token) > 3:
        stem = token[:-2]
        _append_candidate(candidates, stem)
        if len(stem) > 1 and stem[-1] == stem[-2]:
            _append_candidate(candidates, stem[:-1])
        _append_candidate(candidates, f"{stem}e")

    if token.endswith("er") and len(token) > 3:
        _append_candidate(candidates, token[:-2])

    return candidates


def morphology_token_unit(token: str, base_url: str, *, text: str) -> Unit | None:
    for candidate in morphology_candidates(token):
        unit = known_token_unit(candidate, base_url, text=text)
        if unit:
            return unit
        unit = alias_token_unit(candidate, base_url, text=text)
        if unit:
            return unit
    return None


def is_short_acronym(token: SourceToken) -> bool:
    letters_only = re.sub(r"[^A-Za-z]", "", token.original)
    return 2 <= len(letters_only) <= 5 and letters_only.isupper()


def has_spell_intent(tokens: list[SourceToken], index: int) -> bool:
    return any(token.normalized in SPELL_INTENT_TOKENS for token in tokens[:index])


def looks_like_name(token: SourceToken) -> bool:
    letters_only = re.sub(r"[^A-Za-z]", "", token.original)
    if len(letters_only) < 2 or not letters_only.isalpha():
        return False
    if token.original.isupper():
        return False
    return token.original[:1].isupper()


def has_name_intro(tokens: list[SourceToken], end_index: int) -> bool:
    for pattern in NAME_INTRO_PATTERNS:
        start_index = end_index - len(pattern)
        if start_index < 0:
            continue
        if tuple(token.normalized for token in tokens[start_index:end_index]) == pattern:
            return True
    return False


def follows_name_intro(tokens: list[SourceToken], index: int) -> bool:
    if not looks_like_name(tokens[index]):
        return False

    for start_index in range(index + 1):
        if not has_name_intro(tokens, start_index):
            continue
        if all(looks_like_name(token) for token in tokens[start_index:index + 1]):
            return True
    return False


def should_fingerspell_token(tokens: list[SourceToken], index: int) -> bool:
    token = tokens[index]
    return is_short_acronym(token) or has_spell_intent(tokens, index) or follows_name_intro(tokens, index)


def token_to_units(tokens: list[SourceToken], index: int, base_url: str) -> list[Unit]:
    token = tokens[index]
    direct_clip = dataset_token_unit(token.normalized, base_url, text=token.original)
    if direct_clip:
        return [direct_clip]
    return fingerspell_units(token.original, base_url)


def exact_phrase_units(segment: str, base_url: str, *, text: str | None = None) -> list[Unit] | None:
    unit_id = EXACT_PHRASE_LIBRARY.get(segment)
    if not unit_id:
        return None
    return [clip_unit(base_url, unit_id, "phrases", text=text or segment)]


def compose_tokens(tokens: list[SourceToken], base_url: str) -> list[Unit]:
    if not tokens:
        return []

    units: list[Unit] = []
    for index in range(len(tokens)):
        units.extend(token_to_units(tokens, index, base_url))

    return units


def compose_segment(segment: str, base_url: str, tokens: list[SourceToken] | None = None) -> list[Unit]:
    return compose_tokens(tokens or source_tokens(segment), base_url)


def detect_mode(units: Iterable[Unit]) -> str:
    unit_ids = [unit.id for unit in units]
    if unit_ids and all(unit_id.startswith("FS-") for unit_id in unit_ids):
        return "fingerspell"
    if any(unit_id.startswith("FS-") for unit_id in unit_ids):
        return "mixed"
    return "clips"


def is_urgent(units: Iterable[Unit]) -> bool:
    return any(unit.id in URGENT_IDS for unit in units)


def text_is_urgent(text: str) -> bool:
    normalized = normalize_text(text)
    if not normalized:
        return False

    if normalized in EXACT_PHRASE_LIBRARY:
        return EXACT_PHRASE_LIBRARY[normalized] in URGENT_IDS

    tokens = tokenize(normalized)
    if "911" in tokens and "call" in tokens:
        return True

    token_unit_ids = {
        DAY_LIBRARY.get(token)
        or DIGIT_LIBRARY.get(token)
        or UNIT_LIBRARY.get(token)
        or TOKEN_ALIAS_LIBRARY.get(token)
        for token in tokens
    }
    return any(unit_id in URGENT_IDS for unit_id in token_unit_ids if unit_id)


def fallback_plan(text: str, base_url: str) -> tuple[list[Unit], dict[str, object]]:
    segments = split_clauses(text)
    units: list[Unit] = []

    for original_segment, _normalized_segment in segments:
        units.extend(compose_segment(original_segment, base_url))

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


def slt_source_tokens(text: str) -> list[SourceToken]:
    source_aligned_tokens = source_tokens(text)
    slt_tokens = _slt_tokens_for_text(text)

    if len(slt_tokens) != len(source_aligned_tokens):
        return source_aligned_tokens

    return [
        SourceToken(original=source_token.original, normalized=slt_token)
        for source_token, slt_token in zip(source_aligned_tokens, slt_tokens)
    ]


def slt_plan(text: str, base_url: str) -> tuple[list[Unit], dict[str, object]]:
    segments = split_clauses(text)
    units: list[Unit] = []

    for original_segment, _normalized_segment in segments:
        units.extend(compose_segment(original_segment, base_url, tokens=slt_source_tokens(original_segment)))

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
        "priority": "urgent" if is_urgent(units) or text_is_urgent(text) else "normal",
        "fallback_strategy": "signs-data-word-sequence",
        "fingerspell_count": sum(1 for unit in units if unit.id.startswith("FS-")),
        "card_count": sum(1 for unit in units if unit.type == "card" and unit.id != "NO-SIGN-PLAN"),
        "units": [unit.as_dict() for unit in units],
        **metadata,
    }
