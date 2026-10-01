// Odd One Out: pairs of related words. Everyone gets one word of a pair, the imposter gets the other
// (which side the crew gets is picked at random each time). Every word appears only once in the list.
const RAW = `
# Food
pizza|burger
cake|pie
chocolate|candy
milk|juice
coffee|tea
apple|pear
banana|mango
orange|lemon
strawberry|cherry
watermelon|pumpkin
carrot|potato
onion|garlic
rice|pasta
bread|toast
sandwich|taco
popcorn|chips
ice cream|yogurt
honey|jam
salt|sugar

# Animals
cat|dog
lion|tiger
bee|wasp
butterfly|moth
frog|toad
duck|goose
horse|donkey
wolf|fox
shark|dolphin
crocodile|lizard
eagle|hawk
owl|bat
rabbit|hamster
cow|sheep

# Places
beach|pool
river|lake
mountain|hill
castle|palace
hospital|pharmacy
library|bookstore
cinema|theater
zoo|farm
park|garden
desert|jungle
tent|cabin

# Things
guitar|violin
drum|trumpet
piano|organ
pen|pencil
book|magazine
laptop|tablet
spoon|fork
cup|bowl
bed|sofa
chair|stool
window|door
sock|glove
shirt|jacket
hat|helmet
soap|shampoo
toothbrush|comb
umbrella|raincoat
glasses|sunglasses
ring|necklace
watch|clock
candle|lamp
camera|binoculars
knife|scissors
hammer|screwdriver

# Transport
bus|train
airplane|helicopter
rocket|satellite
bicycle|scooter
car|motorcycle
ship|submarine
skateboard|surfboard

# Sports & activities
football|rugby
tennis|badminton
baseball|cricket
basketball|volleyball
golf|bowling
skiing|snowboarding
diving|snorkeling
running|walking
singing|dancing
painting|drawing

# People & stories
doctor|nurse
king|queen
wizard|witch
vampire|zombie
ghost|skeleton
pirate|ninja
police officer|firefighter
teacher|student
chef|waiter
astronaut|pilot

# Nature & time
sun|moon
rain|snow
birthday|wedding
christmas|halloween
`;

export const IMPOSTER_POOL = [];
let category;
for (const line of RAW.split('\n').map(l => l.trim()).filter(Boolean)) {
  if (line.startsWith('#')) { category = line.slice(1).trim(); continue; }
  const [a, b] = line.split('|');
  IMPOSTER_POOL.push({
    id: `imp-${a}-${b}`.toLowerCase().replace(/\s+/g, '-'),
    category,
    answer: a.toUpperCase(), // used by the deck to avoid repeats
    alt: b.toUpperCase(),
    emoji: '🕵️',
  });
}
