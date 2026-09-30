// Question pool. One line per question: answer|emoji|hint, grouped under "# Category" headers.
// Answers, emojis and ids are unique across the pool (checked by test.js).
const RAW = `
# Animals
elephant|🐘|Largest land animal, with a long trunk
giraffe|🦒|Tallest animal on Earth
penguin|🐧|A bird that can't fly but swims brilliantly
dolphin|🐬|Clever sea mammal that clicks and whistles
tiger|🐅|Big striped cat
zebra|🦓|Horse-like animal in black and white stripes
kangaroo|🦘|Hops around Australia with a pouch
octopus|🐙|Eight arms and three hearts
butterfly|🦋|Used to be a caterpillar
turtle|🐢|Carries its house on its back
rabbit|🐇|Long ears, loves carrots
monkey|🐒|Swings from tree to tree
camel|🐫|Desert animal with humps
owl|🦉|Wise night bird that hoots
snail|🐌|Slow and leaves a slimy trail
crocodile|🐊|Scaly reptile with a huge toothy grin
flamingo|🦩|Pink bird standing on one leg
hedgehog|🦔|Small and spiky
peacock|🦚|Shows off colorful tail feathers
gorilla|🦍|The largest ape
parrot|🦜|Colorful bird that can copy words
squirrel|🐿️|Collects nuts for winter
whale|🐋|Largest animal in the ocean
spider|🕷️|Eight legs, spins webs
horse|🐎|You can ride it and it gallops
eagle|🦅|Bird of prey with sharp eyes
shark|🦈|Ocean predator with a famous fin
lion|🦁|King of the jungle
frog|🐸|Green jumper that croaks
bee|🐝|Buzzes and makes honey
koala|🐨|Sleepy Australian tree hugger
panda|🐼|Black-and-white bear that eats bamboo
fox|🦊|Clever orange animal with a bushy tail
pig|🐖|Farm animal that oinks
chicken|🐔|Lays eggs on the farm
bat|🦇|Only mammal that can truly fly
sloth|🦥|The slowest mammal, hangs upside down

# Food
pizza|🍕|Italian dish sold by the slice
apple|🍎|Keeps the doctor away
banana|🍌|Long yellow fruit you peel
burger|🍔|Patty in a bun
cheese|🧀|Made from milk, mice love it
carrot|🥕|Orange vegetable, good for your eyes
pineapple|🍍|Spiky tropical fruit
strawberry|🍓|Red berry with seeds on the outside
broccoli|🥦|Looks like a tiny green tree
avocado|🥑|Green fruit used in guacamole
doughnut|🍩|Fried ring with a hole in the middle
pretzel|🥨|Twisted baked snack
croissant|🥐|Flaky French pastry
watermelon|🍉|Big green fruit, red inside
cookie|🍪|Sweet baked treat, often with chips
popcorn|🍿|Movie snack that pops
pancakes|🥞|Stacked breakfast with syrup
sandwich|🥪|Filling between two slices of bread
taco|🌮|Folded tortilla, Mexican favorite
burrito|🌯|Wrapped-up tortilla meal
lemon|🍋|Sour yellow citrus
cherries|🍒|Small red fruits on stems
grapes|🍇|Grow in bunches, make wine
coconut|🥥|Hairy shell with water inside
spaghetti|🍝|Long thin pasta
sushi|🍣|Japanese rice and raw fish
honey|🍯|Sweet and sticky, made by insects
eggplant|🍆|Purple vegetable, also called aubergine
chili|🌶️|Hot red pepper
corn|🌽|Yellow kernels on a cob
bread|🍞|Baked loaf you slice
cupcake|🧁|Small cake with frosting
lollipop|🍭|Candy on a stick
chocolate|🍫|Sweet treat made from cocoa
peach|🍑|Fuzzy fruit with a stone
garlic|🧄|Keeps vampires away
onion|🧅|Makes you cry when you cut it
waffle|🧇|Breakfast with little squares
butter|🧈|Yellow spread made from cream
salad|🥗|Bowl of leafy greens

# Vehicles
bicycle|🚲|Two wheels and pedals
helicopter|🚁|Flies with spinning blades on top
rocket|🚀|Blasts off into space
tractor|🚜|Farm vehicle with big wheels
ambulance|🚑|Rushes patients to hospital
airplane|✈️|Flies passengers between countries
sailboat|⛵|Moved by the wind on water
motorcycle|🏍️|Two-wheeler with an engine
train|🚆|Runs on rails
taxi|🚕|Yellow car you hail
bus|🚌|Big vehicle with many seats
scooter|🛴|Kick to push it along
canoe|🛶|Narrow boat you paddle
fire truck|🚒|Red vehicle with a ladder and siren
police car|🚓|Cops drive it with flashing lights
skateboard|🛹|Board on four wheels
truck|🚚|Delivers heavy loads
tram|🚊|Streetcar on city rails
parachute|🪂|Slows your fall from a plane
ship|🚢|Large vessel on the ocean
race car|🏎️|Very fast car on a track

# Objects
umbrella|☂️|Keeps you dry in the rain
scissors|✂️|Two blades that cut paper
hammer|🔨|Hits nails
lightbulb|💡|Glows when you have an idea
telescope|🔭|Look at the stars with it
microscope|🔬|See tiny things up close
magnet|🧲|Attracts metal
candle|🕯️|Wax with a flame
balloon|🎈|Filled with air or helium
envelope|✉️|Paper holder for letters
backpack|🎒|Carry school books on your back
glasses|👓|Help you see clearly
crown|👑|Worn by a king or queen
anchor|⚓|Keeps a ship in place
compass|🧭|Always points north
hourglass|⌛|Sand measures the time
padlock|🔒|Locks with a key or code
key|🔑|Opens a lock
trumpet|🎺|Brass instrument you blow
guitar|🎸|Six-string instrument
violin|🎻|Played with a bow under your chin
drum|🥁|Hit it with sticks
bell|🔔|Rings ding-dong
broom|🧹|Sweeps the floor
teddy bear|🧸|Cuddly stuffed toy
puzzle|🧩|Fit the pieces together
camera|📷|Takes photos
telephone|☎️|Classic device to make calls
battery|🔋|Stores power
pencil|✏️|Write and erase
paintbrush|🖌️|Artist's tool for color
basket|🧺|Woven container for laundry or picnics
sponge|🧽|Soaks up water when cleaning
soap|🧼|Wash your hands with it
kite|🪁|Flies on a string in the wind
magnifying glass|🔍|Makes things look bigger

# Sports
soccer|⚽|Kick the ball into the goal
basketball|🏀|Shoot hoops
baseball|⚾|Bat, ball and home runs
tennis|🎾|Racket sport at Wimbledon
bowling|🎳|Knock down ten pins
volleyball|🏐|Hit the ball over a high net
boxing|🥊|Fight with padded gloves
skiing|⛷️|Slide down snowy slopes
surfing|🏄|Ride the ocean waves
fishing|🎣|Rod, line and patience
trophy|🏆|Awarded to the champion
medal|🏅|Gold, silver or bronze
golf|⛳|Hole in one
cricket|🏏|Bat and wickets
hockey|🏒|Sticks and a puck
badminton|🏸|Hit the shuttlecock
karate|🥋|Martial art with belts
darts|🎯|Aim for the bullseye
chess|♟️|Checkmate the king
swimming|🏊|Laps in the pool
rugby|🏉|Oval ball, big tackles
weightlifting|🏋️|Lift the heavy barbell
cycling|🚴|Tour de France sport

# Movies
clapperboard|🎬|Snaps shut when the scene starts
ticket|🎟️|Your pass to get in
ghost|👻|Says boo, haunts houses
robot|🤖|Metal machine that acts like a human
alien|👽|Visitor from another planet
dragon|🐉|Fire-breathing mythical beast
unicorn|🦄|Magical horse with a horn
wizard|🧙|Casts spells with a wand
vampire|🧛|Drinks blood, avoids sunlight
dinosaur|🦖|Roamed the Earth long ago
zombie|🧟|Walking undead
mermaid|🧜|Half fish, half human
superhero|🦸|Saves the day with powers
clown|🤡|Red nose and big shoes
detective|🕵️|Solves mysteries
genie|🧞|Grants three wishes
fairy|🧚|Tiny magical being with wings

# Technology
laptop|💻|Portable computer
keyboard|⌨️|Keys you type on
satellite|🛰️|Orbits the Earth
joystick|🕹️|Controls old arcade games
smartphone|📱|Pocket computer that makes calls
printer|🖨️|Puts documents on paper
television|📺|Watch shows on it
radio|📻|Tune in to stations
headphones|🎧|Listen privately
microphone|🎤|Makes your voice louder
floppy disk|💾|The save icon
mouse|🖱️|Point and click
abacus|🧮|Ancient counting frame
video game|🎮|Play it with a controller
flashlight|🔦|Lights up the dark
plug|🔌|Goes into the socket
email|📧|Electronic mail
calendar|📅|Shows dates and months

# Nature
volcano|🌋|Mountain that erupts lava
rainbow|🌈|Seven colors after the rain
cactus|🌵|Spiky desert plant
sunflower|🌻|Tall yellow flower facing the sun
tornado|🌪️|Spinning windstorm
snowflake|❄️|Every one is unique
lightning|⚡|Flash in a storm
mountain|⛰️|Climb to the peak
rose|🌹|Red flower with thorns
tulip|🌷|Dutch spring flower
moon|🌙|Shines at night
comet|☄️|Space rock with a tail
maple leaf|🍁|On Canada's flag
palm tree|🌴|Grows on tropical beaches
wave|🌊|Rolls onto the shore
fire|🔥|Hot and burning
star|⭐|Twinkles in the night sky
cloud|☁️|Fluffy and white in the sky
sun|☀️|Our closest star
tree|🌳|Has a trunk and leaves
clover|🍀|Four leaves bring good luck
globe|🌍|Model of the Earth
planet|🪐|Saturn has rings
seedling|🌱|A baby plant
mushroom|🍄|Fungus with a cap
hibiscus|🌺|Tropical flower worn in the hair
snowman|⛄|Built from snow with a carrot nose

# Places
castle|🏰|Home of kings with towers
hospital|🏥|Where doctors work
stadium|🏟️|Huge venue for games and concerts
statue of liberty|🗽|Famous New York landmark
desert|🏜️|Hot, dry and sandy
island|🏝️|Land surrounded by water
factory|🏭|Where things are manufactured
school|🏫|Where students learn
bank|🏦|Keeps your money safe
church|⛪|Place of worship with a steeple
tent|⛺|Sleep in it while camping
ferris wheel|🎡|Giant wheel at the fair
roller coaster|🎢|Thrilling ride with loops
carousel|🎠|Merry-go-round with horses
fountain|⛲|Water sprays in the park
bridge|🌉|Crosses over a river
house|🏠|Where you live
circus|🎪|Big top with acrobats
hotel|🏨|Stay here on holiday
post office|🏤|Send letters and parcels
tokyo tower|🗼|Red-and-white tower in Japan

# Everyday Items
alarm clock|⏰|Wakes you up in the morning
sneaker|👟|Sporty shoe
socks|🧦|Worn under your shoes
scarf|🧣|Keeps your neck warm
gloves|🧤|Keep your hands warm
dress|👗|One-piece outfit
jeans|👖|Blue denim trousers
necktie|👔|Worn with a formal shirt
top hat|🎩|Tall hat for magicians
lipstick|💄|Colors your lips
ring|💍|Worn on a finger, sign of marriage
handbag|👜|Carries your things
bathtub|🛁|Soak in it
toilet|🚽|Flush it
bed|🛏️|Sleep in it
couch|🛋️|Sit and relax in the living room
chair|🪑|Four legs, one seat
door|🚪|Open it to go in
newspaper|📰|Daily printed news
book|📖|Pages to read
gift|🎁|Wrapped present
shopping cart|🛒|Push it at the supermarket
purse|👛|Small bag for coins
thermometer|🌡️|Measures temperature
pill|💊|Medicine you swallow
bandage|🩹|Covers a small cut
razor|🪒|Used for shaving
safety pin|🧷|Pin with a clasp
toolbox|🧰|Holds your tools
lotion|🧴|Squeeze bottle for your skin
`;

export const POOL = [];
let category;
for (const line of RAW.split('\n').map(l => l.trim()).filter(Boolean)) {
  if (line.startsWith('#')) { category = line.slice(1).trim(); continue; }
  const [answer, emoji, hint] = line.split('|');
  POOL.push({
    id: `${category}-${answer}`.toLowerCase().replace(/\s+/g, '-'),
    category,
    answer: answer.toUpperCase(),
    emoji,
    hint,
  });
}
