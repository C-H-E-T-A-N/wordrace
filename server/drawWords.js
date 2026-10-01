// Draw & Guess words: easy to draw. One line per word: word|emoji (the emoji is only shown to the drawer and at the reveal).
const RAW = `
# Animals
dog|🐶
cat|🐱
fish|🐟
bird|🐦
snake|🐍
elephant|🐘
giraffe|🦒
rabbit|🐰
turtle|🐢
spider|🕷️
butterfly|🦋
octopus|🐙
penguin|🐧
lion|🦁
pig|🐷
cow|🐄
duck|🦆
snail|🐌
shark|🦈
whale|🐳
frog|🐸
owl|🦉
horse|🐴
bee|🐝

# Food
pizza|🍕
ice cream|🍦
banana|🍌
apple|🍎
burger|🍔
cake|🎂
carrot|🥕
watermelon|🍉
egg|🥚
cheese|🧀
hot dog|🌭
cookie|🍪
cherry|🍒
lollipop|🍭
bread|🍞
grapes|🍇
popcorn|🍿
donut|🍩

# Vehicles
car|🚗
bicycle|🚲
airplane|✈️
boat|⛵
rocket|🚀
train|🚂
bus|🚌
helicopter|🚁
truck|🚚
tractor|🚜
submarine|🛥️
motorcycle|🏍️
skateboard|🛹
hot air balloon|🎈

# Movies
ghost|👻
robot|🤖
alien|👽
dragon|🐉
unicorn|🦄
monster|👾
mermaid|🧜
superhero|🦸
wizard|🧙
vampire|🧛
zombie|🧟
pirate|🦜

# Sports
football|🏈
soccer ball|⚽
basketball|🏀
tennis|🎾
bowling|🎳
golf|⛳
trophy|🏆
medal|🏅
skiing|⛷️
surfing|🏄
boxing|🥊
fishing rod|🎣

# Objects
umbrella|☂️
guitar|🎸
camera|📷
scissors|✂️
key|🔑
lamp|💡
clock|⏰
book|📖
pencil|✏️
hammer|🔨
ladder|🪜
chair|🪑
glasses|👓
crown|👑
anchor|⚓
candle|🕯️
balloon|🎈
gift|🎁
bell|🔔
kite|🪁
drum|🥁
magnet|🧲

# Technology
phone|📱
laptop|💻
television|📺
computer mouse|🖱️
headphones|🎧
battery|🔋
flashlight|🔦
satellite|🛰️
game controller|🎮
microphone|🎤

# Nature
sun|☀️
moon|🌙
star|⭐
tree|🌳
flower|🌸
mountain|⛰️
rainbow|🌈
cloud|☁️
volcano|🌋
cactus|🌵
snowman|⛄
leaf|🍁
lightning|⚡
wave|🌊
island|🏝️
mushroom|🍄

# Places
house|🏠
castle|🏰
school|🏫
hospital|🏥
bridge|🌉
tent|⛺
lighthouse|🗼
beach|🏖️
church|⛪
pyramid|🔺
farm|🌾
park|🌳

# Actions
swimming|🏊
running|🏃
sleeping|😴
dancing|💃
jumping|🦘
crying|😢
laughing|😂
reading|📚
cooking|🍳
singing|🎤
climbing|🧗
flying|🕊️
painting|🎨
eating|🍽️

# Everyday Objects
toothbrush|🪥
spoon|🥄
cup|☕
bed|🛏️
door|🚪
window|🪟
shoe|👟
sock|🧦
hat|🎩
shirt|👕
bag|👜
bucket|🪣
bottle|🍼
fork|🍴
mirror|🪞
pillow|🛌
`;

export const DRAW_POOL = [];
let category;
for (const line of RAW.split('\n').map(l => l.trim()).filter(Boolean)) {
  if (line.startsWith('#')) { category = line.slice(1).trim(); continue; }
  const [answer, emoji] = line.split('|');
  DRAW_POOL.push({
    id: `draw-${answer}`.toLowerCase().replace(/\s+/g, '-'),
    category,
    answer: answer.toUpperCase(),
    emoji,
  });
}
