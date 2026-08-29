import numpy as np
from dataclasses import dataclass
from .prosody_extractor import ProsodyFeatures

@dataclass
class AlignedText:
    text: str
    word_durations: list[float]    # how long each word should take
    word_pitches: list[float]      # target pitch per word
    pause_positions: list[int]     # word indices where pauses should occur
    pause_durations: list[float]   # duration of each pause

class PhonemeAligner:
    """
    Given text and a speaker's prosody profile, predicts
    how that speaker would time the words — their natural rhythm.
    This is what gives the 'feels like the same person talking' effect.
    """

    # Syllable counts for common words (simplified)
    SYLLABLE_COUNTS = {
        "the": 1, "a": 1, "an": 1, "is": 1, "are": 1, "was": 1, "were": 1,
        "have": 1, "has": 1, "had": 1, "will": 1, "would": 1, "could": 1,
        "should": 1, "may": 1, "might": 1, "must": 1, "can": 1, "do": 1,
        "does": 1, "did": 1, "not": 1, "no": 1, "yes": 1, "please": 1,
        "about": 2, "above": 2, "after": 2, "again": 2, "also": 2,
        "because": 3, "before": 2, "between": 2, "different": 3,
        "important": 3, "information": 4, "interesting": 4, "understand": 3,
    }

    def _count_syllables(self, word: str) -> int:
        """Estimate syllable count for a word."""
        word_lower = word.lower().strip(".,!?;:'\"")
        if word_lower in self.SYLLABLE_COUNTS:
            return self.SYLLABLE_COUNTS[word_lower]
        # Fallback: count vowel groups
        import re
        vowels = re.findall(r'[aeiouAEIOU]+', word)
        return max(1, len(vowels))

    def align(self, text: str, prosody: ProsodyFeatures) -> AlignedText:
        """
        Predict per-word timing based on speaker's prosody profile.
        """
        words = text.split()
        if not words:
            return AlignedText(text, [], [], [], [])

        # Base duration per syllable from speaker's rate
        syl_duration = 1.0 / prosody.speaking_rate   # seconds per syllable

        word_durations = []
        word_pitches = []
        pause_positions = []
        pause_durations = []

        # F0 contour normalization
        f0_range = prosody.f0_std * 2
        f0_base = prosody.f0_mean

        for i, word in enumerate(words):
            # Duration based on syllable count + speaker's natural variance
            n_syls = self._count_syllables(word)
            # Add natural variance based on speaker's rhythm std
            variance = np.random.normal(0, prosody.syllable_durations.std()
                                        if len(prosody.syllable_durations) > 1 else 0.02)
            duration = max(0.08, n_syls * syl_duration + variance)
            word_durations.append(duration)

            # Pitch: approximate sentence intonation (rises mid-sentence, falls at end)
            position = i / len(words)
            if position < 0.3:
                pitch = f0_base + f0_range * 0.1 * position    # slight rise
            elif position < 0.7:
                pitch = f0_base + f0_range * 0.15              # peak
            else:
                pitch = f0_base - f0_range * 0.2 * (position - 0.7)  # fall
            word_pitches.append(max(50.0, pitch))

            # Insert pauses after punctuation or clause boundaries
            word_strip = word.rstrip(".,!?;:")
            if word != word_strip or word.endswith((",", ";")):
                pause_positions.append(i)
                # Pause duration sampled from speaker's distribution
                pause_dur = max(0.1, np.random.normal(
                    prosody.pause_duration_mean,
                    prosody.pause_duration_std * 0.3
                ))
                pause_durations.append(pause_dur)

        return AlignedText(
            text=text,
            word_durations=word_durations,
            word_pitches=word_pitches,
            pause_positions=pause_positions,
            pause_durations=pause_durations,
        )

phoneme_aligner = PhonemeAligner()