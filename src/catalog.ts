export type ModifierOption = {
  name: string;
  price: number;
};

export type ModifierGroup = {
  name: string;
  required: boolean;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  salePrice?: number;
  category: string;
  available: boolean;
  featured: boolean;
  stock?: number;
  imageUrl?: string;
  accent: string;
  modifiers: ModifierGroup[];
};

export const initialProducts: Product[] = [
  {
    id: "fig-matcha",
    sku: "FF-MAT-001",
    name: "Fig & Froth Matcha",
    description: "First-harvest matcha, homemade fig syrup, vanilla fig cold foam & a dried fig.",
    price: 9.5,
    category: "Matcha",
    available: true,
    featured: true,
    accent: "fig",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "strawberry-booza",
    sku: "FF-MAT-002",
    name: "Strawberry Booza Matcha",
    description: "First-harvest matcha over strawberry purée, topped with booza cold foam and dried strawberry.",
    price: 9.5,
    category: "Matcha",
    available: true,
    featured: true,
    accent: "berry",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "mango-sticky",
    sku: "FF-MAT-003",
    name: "Mango Sticky Rice Matcha",
    description: "Mango purée, coconut cream, fluffy coconut cold foam & crispy rice.",
    price: 10,
    category: "Matcha",
    available: true,
    featured: true,
    accent: "mango",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "classic-matcha",
    sku: "FF-MAT-004",
    name: "Classic Matcha",
    description: "First-harvest matcha with a sweetener of your choice. Simple, smooth, timeless.",
    price: 8,
    category: "Matcha",
    available: true,
    featured: false,
    accent: "classic",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened base", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "banana-pudding",
    sku: "FF-MAT-005",
    name: "Banana Pudding Matcha",
    description: "Banana purée syrup, banana pudding cold foam, vanilla wafers & a dried banana chip.",
    price: 9.5,
    category: "Matcha",
    available: true,
    featured: false,
    accent: "banana",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "caramel-apple",
    sku: "FF-COF-001",
    name: "Caramel Apple Pie",
    description: "Creamy oat latte, caramel syrup & housemade apple-pie cold foam with a cinnamon finish.",
    price: 9.5,
    category: "Coffee & more",
    available: true,
    featured: true,
    accent: "apple",
    modifiers: [
      { name: "Sweetness", required: true, options: [{ name: "Less sweet", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "oat-latte",
    sku: "FF-COF-002",
    name: "Oat Latte",
    description: "A creamy oat milk latte, served over ice.",
    price: 7.5,
    category: "Coffee & more",
    available: true,
    featured: false,
    accent: "latte",
    modifiers: [
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
  {
    id: "sha3r-matcha",
    sku: "FF-MAT-006",
    name: "Sha3r El-Banat Matcha",
    description: "Matcha, cardamom rose cold foam & sha3r el-banat. Contains pistachio.",
    price: 9.5,
    category: "Matcha",
    available: false,
    featured: false,
    accent: "rose",
    modifiers: [
      { name: "Milk", required: true, options: [{ name: "Whole milk", price: 0 }, { name: "Oat milk", price: 0.75 }] },
      { name: "Sweetness", required: true, options: [{ name: "Unsweetened", price: 0 }, { name: "Regular", price: 0 }, { name: "Sweeter", price: 0 }] },
    ],
  },
];

export const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
