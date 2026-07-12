/* Bright EngMath Word Quest — vocabulary data */
"use strict";

const WQ_SETS = [
  {
    id: "island",
    num: 1,
    name: "Island Adventure",
    nameTh: "ผจญภัยบนเกาะ",
    theme: "island",
    tagline: "Sail to a tropical island and hunt for treasure words!",
    emoji: "🏝️",
    words: [
      { id: "palm-tree", word: "palm tree", ipa: "/pɑːm triː/", th: "ต้นปาล์ม / ต้นมะพร้าว", ex: "A tall palm tree grows on the beach.", icon: "🌴" },
      { id: "hook", word: "hook", ipa: "/hʊk/", th: "ตะขอ", ex: "The pirate has a shiny silver hook.", icon: "🪝" },
      { id: "eye-patch", word: "eye-patch", ipa: "/ˈaɪ pætʃ/", th: "ผ้าปิดตา (โจรสลัด)", ex: "The pirate wears a black eye-patch.", icon: "🏴‍☠️" },
      { id: "binoculars", word: "binoculars", ipa: "/bɪˈnɒkjələz/", th: "กล้องส่องทางไกล", ex: "I can see the ship with my binoculars.", icon: "🔭" },
      { id: "key", word: "key", ipa: "/kiː/", th: "กุญแจ", ex: "This old key opens the treasure chest.", icon: "🗝️" },
      { id: "hammock", word: "hammock", ipa: "/ˈhæmək/", th: "เปลญวน", ex: "Dad is sleeping in a hammock between two trees.", icon: "🌺" },
      { id: "coins", word: "coins", ipa: "/kɔɪnz/", th: "เหรียญ", ex: "The chest is full of gold coins.", icon: "🪙" },
      { id: "spade", word: "spade", ipa: "/speɪd/", th: "พลั่ว / เสียม", ex: "Use a spade to dig in the sand.", icon: "⛏️" },
      { id: "treasure-chest", word: "treasure chest", ipa: "/ˈtreʒə tʃest/", th: "หีบสมบัติ", ex: "We found a treasure chest on the island.", icon: "💰" },
      { id: "hole", word: "hole", ipa: "/həʊl/", th: "หลุม / รู", ex: "They dug a deep hole under the palm tree.", icon: "🕳️" },
      { id: "stone", word: "stone", ipa: "/stəʊn/", th: "ก้อนหิน", ex: "There is a big stone next to the hole.", icon: "🪨" }
    ]
  },
  {
    id: "future",
    num: 2,
    name: "Future Travel",
    nameTh: "การเดินทางแห่งอนาคต",
    theme: "future",
    tagline: "Zoom into the future with amazing ways to travel!",
    emoji: "🚀",
    words: [
      { id: "hang-glider", word: "hang-glider", ipa: "/ˈhæŋ ɡlaɪdə/", th: "เครื่องร่อน", ex: "The hang-glider flies quietly over the hills.", icon: "🪁" },
      { id: "parachute", word: "parachute", ipa: "/ˈpærəʃuːt/", th: "ร่มชูชีพ", ex: "She jumped from the plane with a parachute.", icon: "🪂" },
      { id: "monorail", word: "monorail", ipa: "/ˈmɒnəreɪl/", th: "รถไฟรางเดี่ยว", ex: "The monorail travels above the busy city.", icon: "🚝" },
      { id: "solar-panel", word: "solar panel", ipa: "/ˈsəʊlə ˌpænl/", th: "แผงโซลาร์เซลล์", ex: "Solar panels use energy from the sun.", icon: "🔆" },
      { id: "microlight", word: "microlight", ipa: "/ˈmaɪkrəʊlaɪt/", th: "เครื่องบินเล็กขนาดเบา", ex: "A microlight is a very small, light plane.", icon: "🛩️" },
      { id: "wind-turbine", word: "wind turbine", ipa: "/ˈwɪnd ˌtɜːbaɪn/", th: "กังหันลม", ex: "The wind turbine turns in the strong wind.", icon: "🌬️" },
      { id: "cable-car", word: "cable car", ipa: "/ˈkeɪbl kɑː/", th: "กระเช้าลอยฟ้า", ex: "We rode a cable car up the mountain.", icon: "🚡" },
      { id: "jet-pack", word: "jet pack", ipa: "/ˈdʒet pæk/", th: "เจ็ตแพ็ก (เครื่องพ่นไอพ่นติดหลัง)", ex: "He flew over the river with a jet pack.", icon: "🚀" },
      { id: "surfboard", word: "surfboard", ipa: "/ˈsɜːfbɔːd/", th: "กระดานโต้คลื่น", ex: "She rides the big waves on her surfboard.", icon: "🏄" },
      { id: "inline-skates", word: "inline skates", ipa: "/ˌɪnlaɪn ˈskeɪts/", th: "รองเท้าสเก็ตอินไลน์", ex: "I wear a helmet when I use my inline skates.", icon: "🛼" },
      { id: "unicycle", word: "unicycle", ipa: "/ˈjuːnɪsaɪkl/", th: "จักรยานล้อเดียว", ex: "Riding a unicycle is not easy!", icon: "🎪" },
      { id: "floating-skateboard", word: "floating skateboard", ipa: "/ˌfləʊtɪŋ ˈskeɪtbɔːd/", th: "สเก็ตบอร์ดลอยได้", ex: "In the future, kids will ride floating skateboards.", icon: "🛹" }
    ]
  }
];

const WQ_ACTIVITIES = [
  { id: "learn", title: "Learn the Words", th: "เรียนรู้คำศัพท์", desc: "See, hear and remember every word.", icon: "📖" },
  { id: "match", title: "Read & Match", th: "อ่านและจับคู่", desc: "Match each English word to its Thai meaning.", icon: "🧩" },
  { id: "listen", title: "Listen & Type", th: "ฟังและพิมพ์", desc: "Listen carefully, then type the word.", icon: "🎧" },
  { id: "challenge", title: "Final Challenge", th: "ด่านสุดท้าย", desc: "Mixed reading and listening quiz. Earn your stars!", icon: "🏆" }
];
