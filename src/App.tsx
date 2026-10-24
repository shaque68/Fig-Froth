import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight,
  Clock3, Coffee, Instagram, Leaf, MapPin, Menu as MenuIcon, Minus, Plus,
  Search, ShoppingBag, SlidersHorizontal, Sparkles, Trash2, X,
} from "lucide-react";
import { initialProducts, money, type ModifierGroup, type Product } from "./catalog";

type View = "home" | "menu" | "cart" | "admin" | "checkout" | "confirmation" | "ops";
type CartItem = { key: string; productId: string; quantity: number; selections: Record<string, string> };
type Toast = { message: string; kind: "success" | "error" } | null;

const OpsPage = lazy(() => import("./ops/ui/OpsPage"));
const OPS_HASH = "#behind-the-counter";

const CATALOG_KEY = "fig-froth-catalog-v1";
const CART_KEY = "fig-froth-cart-v1";
function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function DrinkArt({ product, className = "" }: { product: Product; className?: string }) {
  return (
    <div className={`drink-art art-${product.accent} ${className}`} aria-label={`${product.name} drink illustration`} role="img">
      <div className="art-sun" />
      <div className="art-leaf leaf-one" />
      <div className="art-leaf leaf-two" />
      <div className="glass">
        <span className="drink-layer layer-top" />
        <span className="drink-layer layer-mid" />
        <span className="drink-layer layer-bottom" />
        <span className="ice ice-one" />
        <span className="ice ice-two" />
        <span className="glass-straw" />
      </div>
      {product.imageUrl && <img className="drink-photo" src={product.imageUrl} alt="" />}
      <span className="art-caption">made with a little magic</span>
    </div>
  );
}

function isAvailable(product: Product) {
  return product.available && (product.stock === undefined || product.stock > 0);
}

function App() {
  const [products, setProducts] = useState<Product[]>(() => readStorage(CATALOG_KEY, initialProducts));
  const [cart, setCart] = useState<CartItem[]>(() => readStorage(CART_KEY, []));
  const [view, setView] = useState<View>(() => window.location.hash === OPS_HASH ? "ops" : "home");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [menuCategory, setMenuCategory] = useState("All sips");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState("featured");
  const [toast, setToast] = useState<Toast>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [pickupTime, setPickupTime] = useState("Next available");
  const [coupon, setCoupon] = useState("");
  const [couponMessage, setCouponMessage] = useState("");
  const [squareReturn, setSquareReturn] = useState(false);
  const [checkoutAvailable, setCheckoutAvailable] = useState<boolean | null>(null);
  const [checkoutEnvironment, setCheckoutEnvironment] = useState("sandbox");
  const [checkoutError, setCheckoutError] = useState("");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const checkoutAttempt = useRef<{ signature: string; key: string } | null>(null);

  useEffect(() => localStorage.setItem(CATALOG_KEY, JSON.stringify(products)), [products]);
  useEffect(() => localStorage.setItem(CART_KEY, JSON.stringify(cart)), [cart]);
  useEffect(() => {
    if (view === "ops" && window.location.hash !== OPS_HASH) window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${OPS_HASH}`);
    if (view !== "ops" && window.location.hash === OPS_HASH) window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
  }, [view]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("square_checkout") !== "returned") return;
    setSquareReturn(true);
    checkoutAttempt.current = null;
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/checkout/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("Couldn’t check Square checkout availability.");
        return response.json() as Promise<{ available: boolean; environment: string }>;
      })
      .then((status) => {
        if (!active) return;
        setCheckoutAvailable(status.available);
        setCheckoutEnvironment(status.environment);
      })
      .catch(() => {
        if (active) {
          setCheckoutAvailable(false);
          setCheckoutError("The checkout server isn’t available. Start the app with npm run dev and try again.");
        }
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const itemCount = cart.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cart.reduce((total, item) => {
    const product = productById.get(item.productId);
    if (!product) return total;
    const modifiers = product.modifiers.reduce((sum, group) => {
      const option = group.options.find((candidate) => candidate.name === item.selections[group.name]);
      return sum + (option?.price ?? 0);
    }, 0);
    return total + ((product.salePrice ?? product.price) + modifiers) * item.quantity;
  }, 0);
  const tax = subtotal * 0.06625;
  const total = subtotal + tax;
  const blockedCartItems = Array.from(new Set(cart.flatMap((item) => {
    const product = productById.get(item.productId);
    if (!product || !isAvailable(product)) return [product?.name ?? "An unavailable item"];
    const productQuantity = cart.filter((cartItem) => cartItem.productId === product.id).reduce((sum, cartItem) => sum + cartItem.quantity, 0);
    return product.stock !== undefined && productQuantity > product.stock ? [product.name] : [];
  })));
  const availableCategories = Array.from(new Set(products.map((product) => product.category)));
  const displayedProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = products.filter((product) => {
      const categoryMatches = menuCategory === "All sips" || product.category === menuCategory;
      const searchMatches = !query || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(query);
      return categoryMatches && searchMatches;
    });
    if (sortOrder === "price-low") return [...filtered].sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price));
    if (sortOrder === "price-high") return [...filtered].sort((a, b) => (b.salePrice ?? b.price) - (a.salePrice ?? a.price));
    return filtered;
  }, [menuCategory, products, search, sortOrder]);

  function addToCart(product: Product, selections: Record<string, string>, quantity: number) {
    if (!isAvailable(product)) {
      setToast({ message: `${product.name} is not available right now.`, kind: "error" });
      return;
    }
    const productQuantity = cart.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
    if (product.stock !== undefined && productQuantity + quantity > product.stock) {
      setToast({ message: `Only ${Math.max(0, product.stock - productQuantity)} ${product.stock - productQuantity === 1 ? "item is" : "items are"} left.`, kind: "error" });
      return;
    }
    const key = `${product.id}-${Object.entries(selections).sort().map(([group, option]) => `${group}:${option}`).join("|")}`;
    setCart((current) => {
      const existing = current.find((item) => item.key === key);
      return existing
        ? current.map((item) => item.key === key ? { ...item, quantity: item.quantity + quantity } : item)
        : [...current, { key, productId: product.id, quantity, selections }];
    });
    setSelectedProduct(null);
    setToast({ message: `${product.name} added to your bag`, kind: "success" });
  }

  function updateQuantity(key: string, delta: number) {
    const cartItem = cart.find((item) => item.key === key);
    const product = cartItem && productById.get(cartItem.productId);
    if (delta > 0 && product?.stock !== undefined) {
      const productQuantity = cart.filter((item) => item.productId === product.id).reduce((sum, item) => sum + item.quantity, 0);
      if (productQuantity + delta > product.stock) {
        setToast({ message: `Only ${Math.max(0, product.stock - productQuantity)} ${product.stock - productQuantity === 1 ? "item is" : "items are"} left.`, kind: "error" });
        return;
      }
    }
    setCart((current) => current.flatMap((item) =>
      item.key !== key ? [item] : item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta }],
    ));
  }

  function patchProduct(updated: Product) {
    setProducts((current) => current.map((product) => product.id === updated.id ? updated : product));
  }

  function openMenu(category = "All sips") {
    setMenuCategory(category);
    setSearch("");
    setView("menu");
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showView(nextView: View) {
    setView(nextView);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function applyCoupon() {
    const code = coupon.trim().toUpperCase();
    setCouponMessage(code ? "That code isn't active right now. Check your code and try again." : "Enter a coupon or gift card code first.");
  }

  async function startSquareCheckout(event: React.FormEvent<HTMLFormElement>, buyer: { name: string; email: string; phone?: string }) {
    event.preventDefault();
    if (cart.length === 0 || blockedCartItems.length > 0) return;
    setIsCheckingOut(true);
    setCheckoutError("");
    try {
      const checkoutRequest = {
        items: cart.map(({ productId, quantity, selections }) => ({ productId, quantity, selections })),
        pickupTime,
        buyer,
      };
      const signature = JSON.stringify(checkoutRequest);
      if (!checkoutAttempt.current || checkoutAttempt.current.signature !== signature) {
        checkoutAttempt.current = { signature, key: crypto.randomUUID() };
      }
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...checkoutRequest, idempotencyKey: checkoutAttempt.current.key }),
      });
      const result = await response.json() as { checkoutUrl?: string; error?: string };
      if (!response.ok) throw new Error(result.error || "Square couldn’t start checkout. Please try again.");
      if (!result.checkoutUrl) throw new Error("Square didn’t return a checkout link. Please try again.");
      const checkoutUrl = new URL(result.checkoutUrl);
      if (checkoutUrl.protocol !== "https:" || !["square.link", "sandbox.square.link", "checkout.square.site", "sandbox.checkout.square.site"].includes(checkoutUrl.hostname)) {
        throw new Error("Square returned an unexpected checkout address. Please contact the shop.");
      }
      window.location.assign(checkoutUrl.href);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "Couldn’t connect to Square. Please try again.");
      setIsCheckingOut(false);
    }
  }

  const featured = products.filter((product) => product.featured && isAvailable(product));

  return (
    <div className="site-shell">
      <div className="announcement"><Sparkles size={13} /> A little ritual, a lot of joy <span>·</span> Paterson, NJ</div>
      <header className="site-header">
        <a className="wordmark" href="#home" onClick={(event) => { event.preventDefault(); showView("home"); }}>
          <span className="brand-mark"><Leaf size={22} strokeWidth={1.7} /></span>
          <span className="brand-name">fig <i>&</i> froth<span className="brand-period">.</span><small>SMALL BATCH, BIG COMFORT</small></span>
        </a>
        <nav className={`main-nav ${mobileMenuOpen ? "nav-open" : ""}`} aria-label="Main navigation">
          <button className={view === "home" ? "nav-active" : ""} onClick={() => showView("home")}>Home</button>
          <button className={view === "menu" ? "nav-active" : ""} onClick={() => openMenu()}>The menu</button>
          <button onClick={() => setLocationOpen(true)}>Our little corner <MapPin size={13} /></button>
          <button className={view === "ops" ? "nav-active" : ""} onClick={() => showView("ops")}>Behind the counter</button>
        </nav>
        <div className="header-actions">
          <button className="pickup-chip" onClick={() => setLocationOpen(true)}><MapPin size={15} /><span>Pickup · Paterson</span><ChevronDown size={13} /></button>
          <button className="bag-button" aria-label={`Shopping bag, ${itemCount} items`} onClick={() => showView("cart")}><ShoppingBag size={20} /><span>Bag</span><b>{itemCount}</b></button>
        </div>
        <button className="mobile-menu-button" aria-label="Toggle menu" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? <X /> : <MenuIcon />}</button>
      </header>

      <main>
        {squareReturn && <div className="payment-return-banner" role="status"><Check size={18} /><p><strong>You’re back from Square Checkout.</strong> Check your Square receipt to confirm payment. Your bag stays here until you’re ready.</p><button aria-label="Dismiss payment return message" onClick={() => setSquareReturn(false)}><X size={16} /></button></div>}
        {view === "home" && <HomePage products={featured} onShop={() => openMenu()} onSelect={setSelectedProduct} onCategory={openMenu} />}
        {view === "menu" && <MenuPage products={displayedProducts} categories={availableCategories} category={menuCategory} setCategory={setMenuCategory} search={search} setSearch={setSearch} sortOrder={sortOrder} setSortOrder={setSortOrder} onSelect={setSelectedProduct} />}
        {view === "cart" && <CartPage cart={cart} products={productById} blockedItems={blockedCartItems} subtotal={subtotal} tax={tax} total={total} pickupTime={pickupTime} setPickupTime={setPickupTime} coupon={coupon} setCoupon={setCoupon} couponMessage={couponMessage} applyCoupon={applyCoupon} onQuantity={updateQuantity} onMenu={() => openMenu()} onCheckout={() => showView("checkout")} onLocation={() => setLocationOpen(true)} />}
        {view === "checkout" && <CheckoutPage items={cart} blockedItems={blockedCartItems} pickupTime={pickupTime} checkoutAvailable={checkoutAvailable} environment={checkoutEnvironment} error={checkoutError} isSubmitting={isCheckingOut} onBack={() => showView("cart")} onSubmit={startSquareCheckout} />}
        {view === "ops" && <Suspense fallback={<div className="page-container">Loading the demo…</div>}><OpsPage /></Suspense>}
        {view === "admin" && <AdminPage products={products} onUpdate={patchProduct} onAdd={(product) => setProducts((current) => [...current, product])} onReset={() => { setProducts(initialProducts); setToast({ message: "Menu restored to the original demo catalog.", kind: "success" }); }} />}
      </main>

      <Footer onAdmin={() => showView("admin")} onMenu={() => openMenu()} />

      {selectedProduct && <ProductDialog product={selectedProduct} onClose={() => setSelectedProduct(null)} onAdd={addToCart} />}
      {locationOpen && <LocationDialog onClose={() => setLocationOpen(false)} />}
      {toast && <div className={`toast toast-${toast.kind}`} role="status"><Check size={17} />{toast.message}<button aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={15} /></button></div>}
    </div>
  );
}

function HomePage({ products, onShop, onSelect, onCategory }: { products: Product[]; onShop: () => void; onSelect: (product: Product) => void; onCategory: (category: string) => void }) {
  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> YOUR NEIGHBORHOOD MATCHA BAR</p>
          <h1>Make room for<br /><em>a little lovely.</em></h1>
          <p className="hero-description">Thoughtfully whisked matcha, cozy coffee, and the kind of small-batch sweetness that makes an ordinary day feel like yours.</p>
          <div className="hero-buttons"><button className="button button-dark" onClick={onShop}>Find your favorite <ArrowRight size={16} /></button><button className="text-button" onClick={() => onCategory("Matcha")}>Meet the matcha <ArrowDownWideNarrow size={15} /></button></div>
          <div className="hero-note"><span className="note-avatars"><i>f</i><i>✿</i><i>♡</i></span><span>Whisked by hand, shared with love.</span></div>
        </div>
        <div className="hero-art">
          <div className="hero-image-scene">
            <div className="hero-sun" />
            <div className="hero-flower flower-a">✿</div><div className="hero-flower flower-b">✿</div>
            <div className="hero-cup"><span className="cup-foam" /><span className="cup-green" /><span className="cup-cream" /><span className="cup-label">f<span>&</span>f</span><span className="cup-straw" /></div>
            <div className="hero-shadow" />
          </div>
          <div className="floating-note"><span>♡</span><div>made fresh<br />just for you</div></div>
          <div className="hero-sticker">A GOOD<br />MOOD IN<br />A CUP <span>✳</span></div>
          <div className="hero-art-caption">THE FIG & FROTH MATCHA · OUR HOUSE FAVORITE</div>
        </div>
        <div className="hero-side-text">A PAUSE WORTH SAVORING</div>
        <div className="hero-bottom-mark"><span>01</span><i /> A little slower. A little sweeter.</div>
      </section>

      <section className="promise-strip">
        <div><Leaf size={18} /><span>First-harvest matcha</span></div><span className="promise-dot">✳</span>
        <div><Sparkles size={18} /><span>Made from scratch</span></div><span className="promise-dot">✳</span>
        <div><HeartIcon /><span>Always made with love</span></div>
      </section>

      <section className="featured-section">
        <div className="section-heading"><div><p className="eyebrow">THE CURRENT CRUSHES</p><h2>A few <em>favorites.</em></h2></div><button className="text-button view-menu" onClick={onShop}>Sip your way through <ArrowRight size={16} /></button></div>
        {products.length > 0 ? <div className="product-grid home-product-grid">{products.slice(0, 4).map((product) => <ProductCard key={product.id} product={product} onSelect={onSelect} />)}</div> : <div className="empty-featured"><Coffee /><p>We’re brewing up the next favorite.</p></div>}
        <div className="menu-teaser"><div className="teaser-ornament">✳</div><div><p className="eyebrow">A LITTLE SOMETHING FOR EVERY MOOD</p><h3>Find your <em>kind of cozy.</em></h3></div><button className="button button-outline" onClick={onShop}>Explore the full menu <ArrowRight size={16} /></button></div>
      </section>
      <section className="visit-banner"><div className="visit-stamp">POURED<br />WITH <span>♥</span><br />IN NJ</div><div><p className="eyebrow">COME SAY HELLO</p><h2>Your new favorite<br /><em>little corner.</em></h2><p>Paterson, New Jersey</p></div><button className="button button-cream" onClick={() => onCategory("All sips")}>Come on in <ArrowRight size={16} /></button></section>
    </div>
  );
}

function HeartIcon() {
  return <span className="heart-icon" aria-hidden="true">♡</span>;
}

function ProductCard({ product, onSelect }: { product: Product; onSelect: (product: Product) => void }) {
  const available = isAvailable(product);
  return (
    <article className="product-card">
      <button className="product-art-button" onClick={() => available && onSelect(product)} aria-label={`View ${product.name}`} disabled={!available}>
        <DrinkArt product={product} />
        {product.featured && <span className="product-tag">A HOUSE FAVORITE</span>}
        {!available && <span className="sold-out-tag">SOLD OUT FOR NOW</span>}
      </button>
      <div className="product-card-info">
        <div><p className="product-category">{product.category}</p><h3>{product.name}</h3><p className="product-description">{product.description}</p></div>
        <div className="product-price">{product.salePrice != null && <del>{money(product.price)}</del>}<strong>{money(product.salePrice ?? product.price)}</strong></div>
      </div>
      <button className={`product-add ${!available ? "disabled" : ""}`} disabled={!available} onClick={() => onSelect(product)}>{available ? <>Make it yours <Plus size={15} /></> : "Currently sold out"}</button>
    </article>
  );
}

function MenuPage({ products, categories, category, setCategory, search, setSearch, sortOrder, setSortOrder, onSelect }: { products: Product[]; categories: string[]; category: string; setCategory: (value: string) => void; search: string; setSearch: (value: string) => void; sortOrder: string; setSortOrder: (value: string) => void; onSelect: (product: Product) => void }) {
  return (
    <section className="menu-page page-container">
      <div className="breadcrumbs"><button>Home</button><ChevronRight size={14} /><span>The menu</span></div>
      <div className="menu-title-row"><div><p className="eyebrow"><span className="eyebrow-line" /> MADE FRESH, JUST FOR YOU</p><h1>Find your <em>happy place.</em></h1><p>Every cup gets a little extra love. Pick a mood, make it yours.</p></div><div className="menu-title-art">✿<span>THE GOOD<br />STUFF, RIGHT<br />THIS WAY</span></div></div>
      <div className="menu-toolbar">
        <div className="category-pills" aria-label="Filter by category">{["All sips", ...categories].map((item) => <button key={item} className={category === item ? "pill-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="menu-tools"><label className="search-control"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your sip..." aria-label="Search menu" />{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}</label><label className="sort-control"><SlidersHorizontal size={16} /><select aria-label="Sort menu" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option value="featured">Our favorites first</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option></select><ChevronDown size={14} /></label></div>
      </div>
      {products.length > 0 ? <div className="product-grid menu-product-grid">{products.map((product) => <ProductCard key={product.id} product={product} onSelect={onSelect} />)}</div> : <div className="no-results"><div>☕</div><h2>No sips found just yet.</h2><p>Try another search or browse all our little favorites.</p><button className="button button-dark" onClick={() => { setSearch(""); setCategory("All sips"); }}>Show me everything</button></div>}
      <div className="allergen-note"><Leaf size={18} /><p>Have an allergy or a question about ingredients? <a href="mailto:figandfroth@gmail.com">Send us a note</a> and we’ll take good care of you.</p></div>
    </section>
  );
}

function ProductDialog({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (product: Product, selections: Record<string, string>, quantity: number) => void }) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState("");
  const modifierPrice = product.modifiers.reduce((total, group) => total + (group.options.find((option) => option.name === selections[group.name])?.price ?? 0), 0);
  const itemPrice = (product.salePrice ?? product.price) + modifierPrice;
  function add() {
    const missing = product.modifiers.find((group) => group.required && !selections[group.name]);
    if (missing) { setError(`Choose an option for ${missing.name.toLowerCase()} to continue.`); document.getElementById(`group-${missing.name}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    onAdd(product, selections, quantity);
  }
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="product-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-product-name">
        <button className="dialog-close" aria-label="Close product details" onClick={onClose}><X size={20} /></button>
        <div className="dialog-art"><DrinkArt product={product} /></div>
        <div className="dialog-content"><p className="product-category">{product.category} · MADE WITH LOVE</p><h2 id="dialog-product-name">{product.name}</h2><strong className="dialog-price">{money(itemPrice)}{modifierPrice > 0 && <small> with your choices</small>}</strong><p className="dialog-description">{product.description}</p>
          <div className="quantity-control"><span>Quantity</span><div><button aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity((value) => value - 1)}><Minus size={15} /></button><span aria-live="polite">{quantity}</span><button aria-label="Increase quantity" onClick={() => setQuantity((value) => value + 1)}><Plus size={15} /></button></div></div>
          <div className="modifier-groups">{product.modifiers.map((group) => <ModifierSelector key={group.name} group={group} selected={selections[group.name] ?? ""} onSelect={(value) => { setSelections((current) => ({ ...current, [group.name]: value })); setError(""); }} />)}</div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-dark dialog-add" onClick={add}>Add to bag <span>{money(itemPrice * quantity)}</span></button><p className="dialog-fineprint">Made fresh for pickup in Paterson, NJ</p>
        </div>
      </section>
    </div>
  );
}

function ModifierSelector({ group, selected, onSelect }: { group: ModifierGroup; selected: string; onSelect: (value: string) => void }) {
  return <fieldset className="modifier-group" id={`group-${group.name}`}><legend>{group.name}<span>{group.required ? "REQUIRED · CHOOSE ONE" : "OPTIONAL"}</span></legend><div className="modifier-options">{group.options.map((option) => <label key={option.name} className={selected === option.name ? "option-selected" : ""}><input type="radio" name={`modifier-${group.name}`} checked={selected === option.name} onChange={() => onSelect(option.name)} /><span>{option.name}</span>{option.price > 0 && <strong>+{money(option.price)}</strong>}</label>)}</div></fieldset>;
}

function CartPage({ cart, products, blockedItems, subtotal, tax, total, pickupTime, setPickupTime, coupon, setCoupon, couponMessage, applyCoupon, onQuantity, onMenu, onCheckout, onLocation }: { cart: CartItem[]; products: Map<string, Product>; blockedItems: string[]; subtotal: number; tax: number; total: number; pickupTime: string; setPickupTime: (value: string) => void; coupon: string; setCoupon: (value: string) => void; couponMessage: string; applyCoupon: () => void; onQuantity: (key: string, delta: number) => void; onMenu: () => void; onCheckout: () => void; onLocation: () => void }) {
  return <section className="page-container cart-page"><div className="breadcrumbs"><button onClick={onMenu}>The menu</button><ChevronRight size={14} /><span>Your bag</span></div><div className="page-heading"><p className="eyebrow">GOOD CHOICES, BY THE WAY</p><h1>Your little <em>bag.</em></h1><p>{cart.length === 0 ? "It’s looking a little lonely in here." : `${cart.reduce((n, item) => n + item.quantity, 0)} lovely ${cart.reduce((n, item) => n + item.quantity, 0) === 1 ? "sip" : "sips"} coming right up.`}</p></div>
    {cart.length === 0 ? <div className="empty-cart"><div className="empty-cart-art">♡</div><h2>Your bag is waiting<br />for something <em>lovely.</em></h2><p>Find a new favorite, or come back to an old one.</p><button className="button button-dark" onClick={onMenu}>Find your favorite <ArrowRight size={16} /></button></div> :
      <div className="cart-layout"><div className="cart-lines">{cart.map((item) => { const product = products.get(item.productId); if (!product) return null; const addOn = product.modifiers.reduce((sum, group) => sum + (group.options.find((option) => option.name === item.selections[group.name])?.price ?? 0), 0); return <article className="cart-line" key={item.key}><DrinkArt product={product} className="cart-art" /><div className="cart-line-main"><p className="product-category">{product.category}</p><h2>{product.name}</h2><div className="cart-selections">{Object.entries(item.selections).map(([group, selection]) => <span key={group}>{group}: {selection}</span>)}</div><div className="quantity-control cart-quantity"><span>Quantity</span><div><button aria-label={`Decrease ${product.name} quantity`} disabled={item.quantity <= 1} onClick={() => onQuantity(item.key, -1)}><Minus size={15} /></button><span>{item.quantity}</span><button aria-label={`Increase ${product.name} quantity`} onClick={() => onQuantity(item.key, 1)}><Plus size={15} /></button></div></div></div><div className="cart-line-price"><strong>{money(((product.salePrice ?? product.price) + addOn) * item.quantity)}</strong><button aria-label={`Remove ${product.name} from bag`} onClick={() => onQuantity(item.key, -item.quantity)}><Trash2 size={15} /> Remove</button></div></article>})}
        <button className="text-button cart-continue" onClick={onMenu}><ArrowLeft size={15} /> Add another little something</button>
        <div className="pickup-card"><div className="pickup-icon"><MapPin /></div><div><p className="product-category">PICKUP AT</p><h3>Fig & Froth · Paterson</h3><p>Paterson, NJ</p></div><button className="text-button" onClick={onLocation}>Change</button><label className="pickup-time-label"><Clock3 size={16} /><span>When would you like it?</span><select value={pickupTime} onChange={(event) => setPickupTime(event.target.value)}><option>Next available</option><option>In 30 minutes</option><option>In 1 hour</option><option>Schedule for later</option></select><ChevronDown size={15} /></label></div>
      </div>
      <aside className="order-summary"><p className="eyebrow">THE HAPPY TOTAL</p><h2>Order <em>summary</em></h2>{blockedItems.length > 0 && <p className="cart-stock-error" role="alert">Please remove or adjust unavailable items before checkout: {blockedItems.join(", ")}.</p>}<label className="coupon-field"><input value={coupon} onChange={(event) => setCoupon(event.target.value)} placeholder="Coupon or gift card" /><button onClick={applyCoupon}>Apply</button></label>{couponMessage && <p className="coupon-message" role="status">{couponMessage}</p>}<div className="summary-row"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div className="summary-row"><span>Estimated tax</span><strong>{money(tax)}</strong></div><div className="summary-total"><span>Estimated total</span><strong>{money(total)}</strong></div><p className="tax-note">Your final total is confirmed at checkout.</p><button className="button button-dark checkout-button" disabled={blockedItems.length > 0} onClick={onCheckout}>Continue to checkout <ArrowRight size={16} /></button><div className="safe-note"><span>♡</span> Your details stay safe and sound.</div><p className="demo-note">Demo storefront · payments aren’t connected yet.</p></aside></div>}
  </section>;
}

function CheckoutPage({ items, blockedItems, pickupTime, checkoutAvailable, environment, error, isSubmitting, onBack, onSubmit }: { items: CartItem[]; blockedItems: string[]; pickupTime: string; checkoutAvailable: boolean | null; environment: string; error: string; isSubmitting: boolean; onBack: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>, buyer: { name: string; email: string; phone?: string }) => void }) {
  const unavailableMessage = checkoutAvailable === null
    ? "Checking Square checkout…"
    : checkoutAvailable
      ? `You’ll pay securely on Square ${environment === "production" ? "checkout" : "Sandbox checkout"}.`
      : "Square checkout isn’t configured yet. Add your Square sandbox credentials to .env and restart the server.";
  return <section className="page-container checkout-page"><div className="breadcrumbs"><button onClick={onBack}>Your bag</button><ChevronRight size={14} /><span>Checkout</span></div><div className="page-heading"><p className="eyebrow">ALMOST TIME FOR A TREAT</p><h1>One last <em>little thing.</em></h1><p>Confirm your pickup details, then complete payment securely with Square.</p></div><div className="checkout-layout"><form className="checkout-form" onSubmit={(event) => { const form = new FormData(event.currentTarget); onSubmit(event, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), phone: String(form.get("tel") ?? "") || undefined }); }}><div className="square-checkout-banner"><ShoppingBag size={17} /><p><strong>Secure payment with Square</strong><br />Card details are entered on Square’s hosted checkout, not on this site.</p></div><h2>Your details</h2><label>Your name<input required name="name" autoComplete="name" maxLength={100} placeholder="First and last name" /></label><label>Email address<input required type="email" name="email" autoComplete="email" maxLength={254} placeholder="you@example.com" /></label><label>Phone number <span>OPTIONAL</span><input type="tel" name="tel" autoComplete="tel" maxLength={30} placeholder="(201) 555-0123" /></label><div className="checkout-pickup"><MapPin size={17} /><span>Pickup in <strong>Paterson, NJ</strong><br /><span className="checkout-pickup-time">{pickupTime === "Next available" ? "As soon as possible" : pickupTime}</span></span></div><p className={`square-availability ${checkoutAvailable ? "is-ready" : ""}`} role="status">{unavailableMessage}</p>{error && <p className="checkout-error" role="alert">{error}</p>}{blockedItems.length > 0 && <p className="checkout-error" role="alert">Please update your bag before checkout: {blockedItems.join(", ")}.</p>}<button className="button button-dark checkout-button" type="submit" disabled={!checkoutAvailable || isSubmitting || items.length === 0 || blockedItems.length > 0}>{isSubmitting ? "Connecting to Square…" : <>Continue to Square <ArrowRight size={16} /></>}</button><p className="checkout-fineprint">Square calculates final taxes and shows your total before payment. Your cart remains available if you return without completing checkout.</p></form><div className="checkout-aside"><div className="checkout-aside-icon">✳</div><h3>Made fresh.<br /><em>Made for you.</em></h3><p>Your sips will be prepared with a little extra love at our Paterson pickup spot.</p><button className="text-button" onClick={onBack}><ArrowLeft size={15} /> Back to your bag</button></div></div></section>;
}

type DraftProduct = { name: string; sku: string; description: string; price: string; salePrice: string; category: string; available: boolean; featured: boolean; stock: string; imageUrl: string; modifiers: ModifierGroup[] };
const blankDraft = (): DraftProduct => ({ name: "", sku: "", description: "", price: "", salePrice: "", category: "Matcha", available: true, featured: false, stock: "", imageUrl: "", modifiers: [] });

function AdminPage({ products, onUpdate, onAdd, onReset }: { products: Product[]; onUpdate: (product: Product) => void; onAdd: (product: Product) => void; onReset: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, DraftProduct>>(() => Object.fromEntries(products.map((p) => [p.id, productToDraft(p)])));
  const [newDraft, setNewDraft] = useState(blankDraft);
  const [saved, setSaved] = useState("");
  useEffect(() => setDrafts((current) => Object.fromEntries(products.map((p) => [p.id, current[p.id] ?? productToDraft(p)]))), [products]);
  function saveProduct(id: string) {
    const product = products.find((item) => item.id === id);
    const draft = drafts[id];
    if (!product || !draft) return;
    const price = Number(draft.price);
    const salePrice = draft.salePrice ? Number(draft.salePrice) : undefined;
    const stock = draft.stock.trim() ? Number(draft.stock) : undefined;
    const imageUrl = draft.imageUrl.trim();
    if (!draft.name.trim() || !draft.sku.trim() || !draft.description.trim() || !Number.isFinite(price) || price < 0 || (salePrice !== undefined && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice >= price))) { setSaved(`${id}: Add a name, SKU, description, valid price, and a sale price lower than the regular price.`); return; }
    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) { setSaved(`${id}: Stock must be a non-negative whole number, or blank for untracked stock.`); return; }
    if (imageUrl) {
      try {
        const parsedUrl = new URL(imageUrl);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Unsupported image URL protocol.");
      } catch {
        setSaved(`${id}: Enter a valid http:// or https:// product image URL.`);
        return;
      }
    }
    if (draft.modifiers.some((group) => !isModifierGroup(group))) {
      setSaved(`${id}: Each modifier group needs a name and at least one option with a valid non-negative price.`);
      return;
    }
    onUpdate({ ...product, name: draft.name.trim(), sku: draft.sku.trim(), description: draft.description.trim(), price, salePrice, category: draft.category.trim() || "Other", available: draft.available, featured: draft.featured, stock, imageUrl: imageUrl || undefined, modifiers: draft.modifiers });
    setSaved(`${id}: Saved to this browser.`);
  }
  function createProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(newDraft.price);
    const salePrice = newDraft.salePrice ? Number(newDraft.salePrice) : undefined;
    const stock = newDraft.stock.trim() ? Number(newDraft.stock) : undefined;
    const imageUrl = newDraft.imageUrl.trim();
    if (newDraft.modifiers.some((group) => !isModifierGroup(group))) {
      setSaved("Each modifier group needs a name and at least one option with a valid non-negative price.");
      return;
    }
    if (!newDraft.name.trim() || !newDraft.sku.trim() || !newDraft.description.trim() || !Number.isFinite(price) || price < 0 || (salePrice !== undefined && (!Number.isFinite(salePrice) || salePrice < 0 || salePrice >= price))) { setSaved("Add a name, SKU, description, valid price, and a sale price lower than the regular price."); return; }
    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) { setSaved("Stock must be a non-negative whole number, or blank for untracked stock."); return; }
    if (imageUrl) {
      try {
        const parsedUrl = new URL(imageUrl);
        if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error("Unsupported image URL protocol.");
      } catch {
        setSaved("Enter a valid http:// or https:// product image URL.");
        return;
      }
    }
    const product: Product = { id: `item-${Date.now()}`, sku: newDraft.sku.trim(), name: newDraft.name.trim(), description: newDraft.description.trim(), price, salePrice, category: newDraft.category.trim() || "Other", available: newDraft.available, featured: newDraft.featured, stock, imageUrl: imageUrl || undefined, accent: "fig", modifiers: newDraft.modifiers };
    onAdd(product); setNewDraft(blankDraft()); setSaved("New menu item saved to this browser.");
  }
  return <section className="page-container admin-page"><div className="breadcrumbs"><span>Store tools</span><ChevronRight size={14} /><span>Menu editor</span></div><div className="admin-heading"><div><p className="eyebrow">YOUR MENU, YOUR WAY</p><h1>A little <em>menu magic.</em></h1><p>Edit names, prices, photos, categories, stock and modifiers. Changes are saved in this browser.</p></div><button className="button button-outline" onClick={onReset}>Restore demo menu</button></div><div className="admin-notice"><Sparkles size={18} /><p><strong>Local preview editor</strong> · Changes stay in this browser and do not change what Square charges. The checkout server validates prices and modifiers against <code>src/catalog.ts</code>; update that trusted catalog to change live checkout items.</p></div>{saved && <p className="admin-saved" role="status">{saved}</p>}
    <div className="admin-list">{products.map((product) => { const draft = drafts[product.id] ?? productToDraft(product); const set = (field: keyof DraftProduct, value: string | boolean | ModifierGroup[]) => setDrafts((current) => ({ ...current, [product.id]: { ...draft, [field]: value } })); return <article className="admin-product" key={product.id}><DrinkArt product={product} className="admin-art" /><div className="admin-fields"><div className="admin-fields-top"><strong>{product.name}</strong><span className="product-category">{product.sku}{product.stock !== undefined ? ` · ${product.stock} in stock` : " · stock untracked"}</span></div><div className="admin-input-grid"><label>Item name<input value={draft.name} onChange={(event) => set("name", event.target.value)} /></label><label>SKU<input value={draft.sku} onChange={(event) => set("sku", event.target.value)} /></label><label className="admin-span">Description<textarea value={draft.description} onChange={(event) => set("description", event.target.value)} rows={2} /></label><label>Price ($)<input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => set("price", event.target.value)} /></label><label>Sale price ($)<input type="number" min="0" step="0.01" placeholder="No sale" value={draft.salePrice} onChange={(event) => set("salePrice", event.target.value)} /></label><label>Menu category<input value={draft.category} onChange={(event) => set("category", event.target.value)} /></label><label>Stock (blank = untracked)<input type="number" min="0" step="1" placeholder="Untracked" value={draft.stock} onChange={(event) => set("stock", event.target.value)} /></label><label className="admin-span">Product photo URL<input type="url" placeholder="https://…" value={draft.imageUrl} onChange={(event) => set("imageUrl", event.target.value)} /></label><div className="admin-span"><ModifierEditor groups={draft.modifiers} onChange={(value) => set("modifiers", value)} /></div><div className="admin-toggles"><label><input type="checkbox" checked={draft.available} onChange={(event) => set("available", event.target.checked)} /> Available</label><label><input type="checkbox" checked={draft.featured} onChange={(event) => set("featured", event.target.checked)} /> Featured</label></div></div><button className="button button-dark admin-save" onClick={() => saveProduct(product.id)}><Check size={15} /> Save item</button></div></article>})}</div>
    <form className="admin-new-form" onSubmit={createProduct}><p className="eyebrow">SOMETHING NEW IS BREWING</p><h2>Add a menu item</h2><div className="admin-input-grid"><label>Item name<input required value={newDraft.name} onChange={(event) => setNewDraft({ ...newDraft, name: event.target.value })} /></label><label>SKU<input required value={newDraft.sku} onChange={(event) => setNewDraft({ ...newDraft, sku: event.target.value })} /></label><label className="admin-span">Description<textarea required rows={2} value={newDraft.description} onChange={(event) => setNewDraft({ ...newDraft, description: event.target.value })} /></label><label>Price ($)<input required type="number" min="0" step="0.01" value={newDraft.price} onChange={(event) => setNewDraft({ ...newDraft, price: event.target.value })} /></label><label>Sale price ($)<input type="number" min="0" step="0.01" value={newDraft.salePrice} onChange={(event) => setNewDraft({ ...newDraft, salePrice: event.target.value })} /></label><label>Menu category<input value={newDraft.category} onChange={(event) => setNewDraft({ ...newDraft, category: event.target.value })} /></label><label>Stock (blank = untracked)<input type="number" min="0" step="1" placeholder="Untracked" value={newDraft.stock} onChange={(event) => setNewDraft({ ...newDraft, stock: event.target.value })} /></label><label className="admin-span">Product photo URL<input type="url" placeholder="https://…" value={newDraft.imageUrl} onChange={(event) => setNewDraft({ ...newDraft, imageUrl: event.target.value })} /></label><div className="admin-span"><ModifierEditor groups={newDraft.modifiers} onChange={(modifiers) => setNewDraft({ ...newDraft, modifiers })} /></div><div className="admin-toggles"><label><input type="checkbox" checked={newDraft.available} onChange={(event) => setNewDraft({ ...newDraft, available: event.target.checked })} /> Available</label><label><input type="checkbox" checked={newDraft.featured} onChange={(event) => setNewDraft({ ...newDraft, featured: event.target.checked })} /> Featured</label></div></div><button className="button button-dark" type="submit"><Plus size={16} /> Add item to menu</button></form>
  </section>;
}

function productToDraft(product: Product): DraftProduct {
  return { name: product.name, sku: product.sku, description: product.description, price: String(product.price), salePrice: product.salePrice == null ? "" : String(product.salePrice), category: product.category, available: product.available, featured: product.featured, stock: product.stock == null ? "" : String(product.stock), imageUrl: product.imageUrl ?? "", modifiers: product.modifiers };
}

function ModifierEditor({ groups, onChange }: { groups: ModifierGroup[]; onChange: (groups: ModifierGroup[]) => void }) {
  function updateGroup(index: number, update: Partial<ModifierGroup>) {
    onChange(groups.map((group, groupIndex) => groupIndex === index ? { ...group, ...update } : group));
  }
  function updateOption(groupIndex: number, optionIndex: number, update: { name?: string; price?: number }) {
    onChange(groups.map((group, index) => index === groupIndex
      ? { ...group, options: group.options.map((option, index) => index === optionIndex ? { ...option, ...update } : option) }
      : group));
  }
  return <div className="modifier-editor">
    <div className="modifier-editor-heading"><span>Customize your drink</span><button type="button" className="text-button" onClick={() => onChange([...groups, { name: "New choice", required: true, options: [{ name: "Option", price: 0 }] }])}><Plus size={14} /> Add a choice</button></div>
    {groups.length === 0 && <p className="modifier-editor-empty">No custom choices for this item. Add a choice group if customers can customize it.</p>}
    {groups.map((group, groupIndex) => <fieldset className="modifier-editor-group" key={`${group.name}-${groupIndex}`}>
      <div className="modifier-editor-group-heading"><input aria-label={`Choice group ${groupIndex + 1} name`} value={group.name} onChange={(event) => updateGroup(groupIndex, { name: event.target.value })} /><label><input type="checkbox" checked={group.required} onChange={(event) => updateGroup(groupIndex, { required: event.target.checked })} /> Required</label><button type="button" className="modifier-remove" aria-label={`Remove choice group ${groupIndex + 1}`} onClick={() => onChange(groups.filter((_, index) => index !== groupIndex))}><Trash2 size={14} /></button></div>
      {group.options.map((option, optionIndex) => <div className="modifier-editor-option" key={`${option.name}-${optionIndex}`}><input aria-label={`${group.name} option ${optionIndex + 1} name`} value={option.name} onChange={(event) => updateOption(groupIndex, optionIndex, { name: event.target.value })} placeholder="Option name" /><label>Upcharge <span>$</span><input aria-label={`${group.name} option ${optionIndex + 1} upcharge`} type="number" min="0" step="0.01" value={option.price} onChange={(event) => updateOption(groupIndex, optionIndex, { price: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label><button type="button" className="modifier-remove" aria-label={`Remove ${option.name || `option ${optionIndex + 1}`}`} onClick={() => updateGroup(groupIndex, { options: group.options.filter((_, index) => index !== optionIndex) })}><X size={14} /></button></div>)}
      <button type="button" className="modifier-add-option" onClick={() => updateGroup(groupIndex, { options: [...group.options, { name: "", price: 0 }] })}><Plus size={13} /> Add an option</button>
    </fieldset>)}
  </div>;
}

function isModifierGroup(value: unknown): value is ModifierGroup {
  if (value === null || typeof value !== "object") return false;
  const group = value as Record<string, unknown>;
  return typeof group.name === "string"
    && group.name.trim().length > 0
    && typeof group.required === "boolean"
    && Array.isArray(group.options)
    && group.options.length > 0
    && group.options.every((option) => option !== null
      && typeof option === "object"
      && typeof (option as Record<string, unknown>).name === "string"
      && ((option as Record<string, unknown>).name as string).trim().length > 0
      && typeof (option as Record<string, unknown>).price === "number"
      && Number.isFinite((option as Record<string, number>).price)
      && (option as Record<string, number>).price >= 0);
}

function LocationDialog({ onClose }: { onClose: () => void }) {
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="location-dialog" role="dialog" aria-modal="true" aria-labelledby="location-title"><button className="dialog-close" aria-label="Close location details" onClick={onClose}><X size={20} /></button><div className="location-flower">✿</div><p className="eyebrow">YOUR LITTLE NEIGHBORHOOD SPOT</p><h2 id="location-title">Made fresh in <em>Paterson.</em></h2><div className="location-address"><MapPin /><div><strong>Fig & Froth</strong><p>Paterson, NJ</p></div></div><div className="location-info"><Clock3 size={17} /><p>Pickup timing is confirmed at checkout.<br /><span>Hours may vary — check back for the latest.</span></p></div><a className="location-email" href="mailto:figandfroth@gmail.com">Questions? Say hello <ArrowRight size={15} /></a><button className="button button-dark location-done" onClick={onClose}>Sounds lovely</button></section></div>;
}

function Footer({ onAdmin, onMenu }: { onAdmin: () => void; onMenu: () => void }) {
  return <footer className="site-footer"><div className="footer-main"><div className="footer-brand"><a className="wordmark footer-wordmark" href="#home"><span className="brand-mark"><Leaf size={21} /></span><span className="brand-name">fig <i>&</i> froth<span className="brand-period">.</span><small>SMALL BATCH, BIG COMFORT</small></span></a><p>Little sips, lovingly made.<br />Always happy you’re here.</p><a className="footer-instagram" href="https://www.instagram.com/figandfroth" target="_blank" rel="noreferrer"><Instagram size={17} /> Come say hi on Instagram <ArrowRight size={14} /></a></div><div className="footer-links"><div><p className="eyebrow">COME ON IN</p><button onClick={onMenu}>The menu</button><a href="mailto:figandfroth@gmail.com">Send us a note</a><span>Paterson, NJ</span></div><div><p className="eyebrow">A QUICK NOTE</p><span>Made fresh, to order.</span><span>Pickup in Paterson.</span><button className="admin-link" onClick={onAdmin}>Edit the menu</button></div></div><div className="footer-illustration">✿</div></div><div className="footer-bottom"><span>© 2026 Fig & Froth · Made with a little love.</span><span className="footer-payments">CASH APP&nbsp;&nbsp; · &nbsp;&nbsp;APPLE PAY&nbsp;&nbsp; · &nbsp;&nbsp;VISA&nbsp;&nbsp; · &nbsp;&nbsp;MASTERCARD</span><span>Preview store · Payments not connected</span></div></footer>;
}

export default App;
