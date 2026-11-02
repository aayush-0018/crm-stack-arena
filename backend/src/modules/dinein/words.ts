import { randomInt } from 'crypto';

/**
 * Secret words for Traitor, by category. The traitor is told only the category, so each word
 * should be guessable from a few one-word clues but not from the category alone.
 */
export const WORDS: Record<string, string[]> = {
  'Café food': ['Samosa', 'Croissant', 'Sandwich', 'Pizza', 'Pancakes', 'Brownie', 'Pav bhaji', 'Momos', 'Pasta', 'French fries', 'Maggi', 'Cheesecake'],
  Drinks: ['Masala chai', 'Cold coffee', 'Lassi', 'Lemonade', 'Hot chocolate', 'Milkshake', 'Filter coffee', 'Green tea', 'Coconut water', 'Smoothie'],
  Places: ['Beach', 'Airport', 'Hospital', 'Cinema', 'Railway station', 'School', 'Gym', 'Temple', 'Zoo', 'Wedding hall', 'Library', 'Mall'],
  Animals: ['Elephant', 'Penguin', 'Monkey', 'Camel', 'Peacock', 'Shark', 'Cat', 'Tiger', 'Cow', 'Parrot', 'Snake', 'Giraffe'],
  Jobs: ['Doctor', 'Pilot', 'Chef', 'Teacher', 'Police officer', 'Barber', 'Farmer', 'Dentist', 'Delivery rider', 'Photographer', 'Tailor'],
  'Things at home': ['Pressure cooker', 'Ceiling fan', 'Mirror', 'Umbrella', 'Toothbrush', 'Remote control', 'Pillow', 'Fridge', 'Broom', 'Clock'],
  Sports: ['Cricket', 'Football', 'Badminton', 'Chess', 'Kabaddi', 'Swimming', 'Tennis', 'Carrom', 'Basketball', 'Cycling'],
};

/** A random category and word. */
export function pickWord(): { category: string; word: string } {
  const categories = Object.keys(WORDS);
  const category = categories[randomInt(categories.length)];
  const list = WORDS[category];
  return { category, word: list[randomInt(list.length)] };
}
