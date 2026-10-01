// Categories (Scattergories-style): the category list and the letters a round can use.
// Hard letters (Q, U, V, X, Y, Z) are left out so every round is playable.
export const LETTERS = [...'ABCDEFGHIJKLMNOPRSTW'];

const NAMES = [
  'Animal', 'Food', 'Country', 'City', 'Movie', 'Famous person', "Boy's name", "Girl's name",
  'Fruit or vegetable', 'Sport or game', 'Job', 'Something in a kitchen', 'Brand', 'Song', 'TV show',
  'Clothing', 'Musical instrument', 'Vehicle', 'Something at school', 'Cartoon character', 'Hobby',
  'Drink', 'Body part', 'Something in the sea', 'Thing you can buy in a shop', 'Colour', 'App or website',
  'Holiday destination', 'Superhero', 'Dessert', 'Flower or plant', 'Bird', 'Insect or bug', 'Something in a bathroom',
  'Something cold', 'Something round', 'Famous landmark', 'Language', 'Video game', 'Toy', 'Pizza topping', 'Furniture',
];
// 42 categories: enough for two back-to-back games at the 15-round maximum without any repeats.

export const CATEGORY_POOL = NAMES.map(name => ({ id: `cat-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, answer: name }));
