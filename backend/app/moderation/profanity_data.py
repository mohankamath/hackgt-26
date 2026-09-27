"""Curated word and phrase lists for the fast local moderation layer.

Ported from the original SafeGuard ``models/profanity_data.py`` and trimmed down.
The old list mixed real profanity with everyday words ("video", "photo", "ice", "slow",
"hell"...) which caused constant false positives. Context-dependent categories
(threats, self-harm, drugs, bullying, hate) are now left to OpenAI omni-moderation,
which understands context. The local layer only handles:

- PROFANITY / SLURS / SEXUAL_TERMS: masked in place (message still shown)
- SEXUAL_SOLICITATION_PHRASES: always censored
- GROOMING_HINT_PHRASES: not hidden, but raise severity so the thread analyzer looks sooner
"""

PROFANITY = [
    "fuck", "fucks", "fucking", "fucked", "fucker", "fuckers", "fuckhead", "fuckwit",
    "fuckface", "fuckboy", "motherfucker", "motherfucking", "mother fucker", "clusterfuck",
    "fuckery", "shit", "shits", "shitty", "shithead", "shitface", "shitbag", "shitass",
    "shitting", "bullshit", "asshole", "assholes", "asswipe", "asshat", "assclown",
    "dumbass", "fatass", "jackass", "bitch", "bitches", "bitchy", "bitching", "sonofabitch",
    "bastard", "bastards", "dickhead", "dickwad", "dickweed", "dickface", "cocksucker",
    "cunt", "cunts", "cunty", "piss off", "pissed off", "wanker", "wanking", "twat",
    "twats", "bollocks", "arsehole", "tosser", "bellend", "knobhead", "goddamn",
    "goddamned", "dumbshit", "stfu", "gtfo", "wtf", "kys",
]

SLURS = [
    "nigger", "niggers", "nigga", "niggas", "niggah", "niggaz", "chink", "chinks", "gook",
    "gooks", "spic", "spics", "spick", "spicks", "wetback", "wetbacks", "beaner", "beaners",
    "towelhead", "towelheads", "raghead", "ragheads", "kike", "kikes", "paki", "pakis",
    "sandnigger", "camel jockey", "coon", "coons", "fag", "fags", "faggot", "faggots",
    "dyke", "dykes", "tranny", "trannies", "retard", "retards", "retarded", "spastic",
    "shemale",
]

SEXUAL_TERMS = [
    "porn", "porno", "pornography", "xxx", "cum", "cumming", "cumshot", "jizz", "blowjob",
    "handjob", "rimjob", "dildo", "dildos", "creampie", "gangbang", "orgy", "slut", "sluts",
    "slutty", "whore", "whores", "thot", "thots", "hentai", "nudes", "titties", "tits",
    "pussy", "cock", "cocks", "dick pic", "dickpic", "horny", "sexting", "onlyfans",
]

# Leet-speak character substitutions applied before matching (1:1 so positions line up).
LEET_MAP = str.maketrans(
    {"0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "$": "s", "5": "s", "7": "t"}
)

# Spaced / punctuated obfuscation, e.g. "f.u.c.k", "s h i t", "b!tch" -> canonical term.
# Every pattern requires a separator after the first letter so normal words don't match.
EVASION_PATTERNS = {
    r"f[\W_]+u[\W_]*c[\W_]*k": "fuck",
    r"s[\W_]+h[\W_]*[i1!][\W_]*t": "shit",
    r"b[\W_]+[i1!][\W_]*t[\W_]*c[\W_]*h": "bitch",
    r"c[\W_]+u[\W_]*n[\W_]*t": "cunt",
    r"a[\W_]+s[\W_]*s[\W_]*h[\W_]*[o0][\W_]*l[\W_]*e": "asshole",
    r"n[\W_]+[i1!][\W_]*g[\W_]*g[\W_]*(?:[e3][\W_]*r|[a@])": "nigger",
    r"f[\W_]+[a@][\W_]*g[\W_]*g[\W_]*[o0][\W_]*t": "faggot",
    r"r[\W_]+[e3][\W_]*t[\W_]*[a@][\W_]*r[\W_]*d": "retard",
    r"w[\W_]+h[\W_]*[o0][\W_]*r[\W_]*[e3]": "whore",
    r"s[\W_]+l[\W_]*u[\W_]*t": "slut",
    r"p[\W_]+[o0][\W_]*r[\W_]*n": "porn",
    r"n[\W_]+u[\W_]*d[\W_]*[e3][\W_]*s": "nudes",
}

# Explicit sexual solicitation: always censored regardless of what OpenAI says.
SEXUAL_SOLICITATION_PHRASES = [
    "send nudes", "send me nudes", "send me a nude", "show me nudes", "show me your body",
    "send me your body", "touch yourself", "i want to touch you", "take your clothes off",
    "take off your clothes", "take off your shirt", "naked pic", "naked pics", "nude pic",
    "nude pics", "send me something sexy", "what are you wearing right now",
    "show me your boobs", "sex with you",
]

# Grooming-pattern hints. These are NOT hidden from the child on their own (plenty of
# innocent uses), but they bump severity so the thread-level analyzer runs right away.
GROOMING_HINT_PHRASES: dict[str, list[str]] = {
    "secrecy_request": [
        "dont tell your parents", "dont tell your mom", "dont tell your dad", "dont tell anyone",
        "keep this between us", "our little secret", "our secret", "secrets between us",
        "nobody will know", "no one will know", "delete this chat", "delete our messages",
        "delete these messages", "your parents wouldnt understand",
    ],
    "meetup_request": [
        "meet me alone", "come to my room", "come over to my place", "come to my house",
        "lets meet up", "meet up irl", "meet in person", "i can pick you up", "where do you live",
    ],
    "platform_move": [
        "add me on snap", "add me on snapchat", "move to telegram", "download telegram",
        "download kik", "add me on kik", "text me on whatsapp", "lets talk somewhere else",
        "private app",
    ],
    "age_probing": [
        "how old are you", "what grade are you in", "are you home alone", "are your parents home",
        "are your parents around", "is anyone home with you",
    ],
    "gift_offer": [
        "free robux", "free vbucks", "free v bucks", "ill buy you", "i will buy you",
        "gift card", "i can send you money", "ill send you money", "i can pay you",
    ],
    "personal_info_request": [
        "whats your address", "what is your address", "what school do you go to",
        "send me your number", "whats your number", "give me your number", "send your location",
        "share your location",
    ],
    "flattery": [
        "so mature for your age", "mature for your age", "youre so mature", "youre so pretty",
        "youre so hot", "youre so sexy",
    ],
    "isolation": [
        "your parents dont understand you", "only i understand you", "they dont get you like i do",
        "you can only trust me", "you dont need your friends",
    ],
}
