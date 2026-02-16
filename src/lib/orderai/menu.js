const MENU_ITEMS = [
  {
    id: "maharaja_mac_chicken",
    name: "Maharaja Mac (Chicken)",
    aliases: ["maharaja mac chicken", "maharaja mac", "maharaja"],
    category: "burger",
    veg: false,
    price: 259
  },
  {
    id: "mcaloo_tikki",
    name: "McAloo Tikki",
    aliases: ["mcaloo tikki", "mc aloo tikki", "aloo tikki"],
    category: "burger",
    veg: true,
    price: 69
  },
  {
    id: "mcspicy_paneer",
    name: "McSpicy Paneer",
    aliases: ["mcspicy paneer", "mc spicy paneer", "spicy paneer"],
    category: "burger",
    veg: true,
    price: 229
  },
  {
    id: "big_mac",
    name: "Big Mac",
    aliases: ["big mac"],
    category: "burger",
    veg: false,
    price: 249
  },
  {
    id: "filet_o_fish",
    name: "Filet-O-Fish",
    aliases: ["filet o fish", "filet-of-fish", "fish burger"],
    category: "burger",
    veg: false,
    price: 219
  },
  {
    id: "maharaja_mac_combo",
    name: "Maharaja Mac Combo",
    aliases: ["maharaja mac combo", "maharaja combo", "maharaja mac meal"],
    category: "meal",
    veg: false,
    price: 349
  },
  {
    id: "mcaloo_tikki_meal",
    name: "McAloo Tikki Meal",
    aliases: ["mcaloo tikki meal", "mc aloo tikki meal", "aloo tikki meal", "aloo meal"],
    category: "meal",
    veg: true,
    price: 149
  },
  {
    id: "mcspicy_paneer_meal",
    name: "McSpicy Paneer Meal",
    aliases: ["mcspicy paneer meal", "spicy paneer meal", "paneer meal"],
    category: "meal",
    veg: true,
    price: 299
  },
  {
    id: "happy_meal_veg",
    name: "Happy Meal (Veg)",
    aliases: ["happy meal veg", "veg happy meal", "happy meal"],
    category: "meal",
    veg: true,
    price: 199
  },
  {
    id: "mcsaver_99_meal",
    name: "McSaver Meal",
    aliases: ["mcsaver", "mc saver", "saver meal", "99 meal", "mcsaver meal"],
    category: "meal",
    veg: true,
    price: 99
  },
  {
    id: "fries",
    name: "Fries",
    aliases: ["fries", "french fries"],
    category: "side",
    veg: true,
    defaultSize: "regular",
    prices: {
      regular: 79,
      medium: 109,
      large: 139
    }
  },
  {
    id: "mcnuggets",
    name: "McNuggets",
    aliases: ["mcnuggets", "mc nuggets", "nuggets"],
    category: "side",
    veg: false,
    defaultVariant: "6pc",
    variants: {
      "6pc": 179,
      "10pc": 259
    }
  },
  {
    id: "pizza_mcpuff",
    name: "Pizza McPuff",
    aliases: ["pizza mcpuff", "mcpuff", "mc puff"],
    category: "side",
    veg: true,
    price: 59
  },
  {
    id: "mexican_mcaloo_wrap",
    name: "Mexican McAloo Wrap",
    aliases: ["mexican mcaloo wrap", "mc aloo wrap", "mcaloo wrap", "veg wrap"],
    category: "wrap",
    veg: true,
    price: 129
  },
  {
    id: "coke",
    name: "Coke",
    aliases: ["coke", "coca cola", "cola"],
    category: "beverage",
    veg: true,
    defaultSize: "medium",
    prices: {
      regular: 69,
      medium: 89,
      large: 109
    }
  },
  {
    id: "fanta",
    name: "Fanta",
    aliases: ["fanta"],
    category: "beverage",
    veg: true,
    defaultSize: "medium",
    prices: {
      regular: 69,
      medium: 89,
      large: 109
    }
  },
  {
    id: "thums_up",
    name: "Thums Up",
    aliases: ["thums up", "thumbs up", "thumsup"],
    category: "beverage",
    veg: true,
    defaultSize: "medium",
    prices: {
      regular: 69,
      medium: 89,
      large: 109
    }
  },
  {
    id: "mccafe_coffee",
    name: "McCafe Coffee",
    aliases: ["mccafe coffee", "mc cafe coffee", "hot coffee", "coffee"],
    category: "beverage",
    veg: true,
    price: 119
  },
  {
    id: "cold_coffee",
    name: "Cold Coffee",
    aliases: ["cold coffee"],
    category: "beverage",
    veg: true,
    price: 159
  },
  {
    id: "oreo_shake",
    name: "Oreo Shake",
    aliases: ["oreo shake"],
    category: "beverage",
    veg: true,
    price: 189
  },
  {
    id: "strawberry_shake",
    name: "Strawberry Shake",
    aliases: ["strawberry shake"],
    category: "beverage",
    veg: true,
    price: 189
  },
  {
    id: "mcflurry_oreo",
    name: "McFlurry Oreo",
    aliases: ["mcflurry oreo", "oreo mcflurry", "mcflurry"],
    category: "dessert",
    veg: true,
    price: 129
  },
  {
    id: "mcflurry_brownie",
    name: "McFlurry Brownie",
    aliases: ["mcflurry brownie", "brownie mcflurry"],
    category: "dessert",
    veg: true,
    price: 139
  },
  {
    id: "soft_serve",
    name: "Soft Serve",
    aliases: ["soft serve", "ice cream"],
    category: "dessert",
    veg: true,
    price: 49
  },
  {
    id: "apple_pie",
    name: "Apple Pie",
    aliases: ["apple pie"],
    category: "dessert",
    veg: true,
    price: 79
  },
  {
    id: "mcmuffin",
    name: "McMuffin",
    aliases: ["mcmuffin", "mc muffin"],
    category: "breakfast",
    veg: true,
    breakfastOnly: true,
    price: 149
  },
  {
    id: "hash_brown",
    name: "Hash Brown",
    aliases: ["hash brown", "hashbrown"],
    category: "breakfast",
    veg: true,
    breakfastOnly: true,
    price: 99
  }
];

function getMenuItems() {
  return MENU_ITEMS.slice();
}

module.exports = { MENU_ITEMS, getMenuItems };
