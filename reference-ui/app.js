/*
  UI demo only. In production, replace loadCatalogue() with GET /products and
  keep product publication, price, margin and fulfillment controlled by the API.
*/
const demoCatalogue = [
  { id: 'demo-unlocktool', name: 'UnlockTool', mode: 'Aluguel 6 horas', price: 29.90, pix: 29.00, type: 'aluguel', art: 'UT', tone: 'orange', tag: 'Mais vendido' },
  { id: 'demo-chimera', name: 'Chimera Tool', mode: 'Licença 6 meses', price: 189.90, pix: 179.00, type: 'licenca', art: 'CH', tone: 'orange' },
  { id: 'demo-amt', name: 'AMT Tool', mode: 'Aluguel 24 horas', price: 49.90, pix: 47.40, type: 'aluguel', art: 'AMT', tone: 'blue' },
  { id: 'demo-octoplus', name: 'Octoplus Samsung', mode: 'Licença 3 meses', price: 109.90, pix: 104.40, type: 'licenca', art: 'OCT', tone: 'navy' },
  { id: 'demo-hydra', name: 'Hydra Tool', mode: 'Licença 1 ano', price: 199.90, pix: 189.90, type: 'licenca', art: 'HYD', tone: 'teal' }
];
let activeFilter = 'todos';
let cart = [];
const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const productsEl = document.querySelector('#products');
const cartEl = document.querySelector('#cart');
const overlay = document.querySelector('#overlay');

async function loadCatalogue() {
  // This fixture lets the layout be evaluated before the provider adapter exists.
  // A real API response should contain only reviewed/published products.
  return demoCatalogue;
}
function productCard(product) {
  return `<article class="product"><div class="product-art" data-tone="${product.tone}"><i>${product.art}</i>${product.tag ? `<span class="tag">${product.tag}</span>` : ''}</div><h3>${product.name}</h3><p class="mode">${product.mode}</p><p class="price">${money(product.price)}</p><span class="pix-price">${money(product.pix)} no PIX</span><div class="release">Liberação automática</div><button class="buy-button" data-add="${product.id}">COMPRAR AGORA</button></article>`;
}
async function renderCatalogue() {
  const products = await loadCatalogue();
  const visible = activeFilter === 'todos' ? products : products.filter(product => product.type === activeFilter);
  productsEl.innerHTML = visible.length ? visible.map(productCard).join('') : '<p class="empty">Não encontramos itens nesta categoria.</p>';
  document.querySelector('#catalogStatus').textContent = `${visible.length} itens demonstrativos - catálogo real será sincronizado pelo servidor.`;
}
function renderCart() {
  document.querySelector('#cartCount').textContent = cart.length;
  const total = cart.reduce((sum, product) => sum + product.pix, 0);
  document.querySelector('#cartTotal').textContent = money(total);
  document.querySelector('#cartItems').innerHTML = cart.length ? cart.map((product, index) => `<article class="cart-item"><div class="cart-icon">${product.art}</div><div><b>${product.name}</b><small>${product.mode} · ${money(product.pix)} no PIX</small></div><button class="remove" data-remove="${index}" aria-label="Remover ${product.name}">×</button></article>`).join('') : '<p class="empty">Seu carrinho está vazio.</p>';
}
function openCart() { cartEl.classList.add('open'); overlay.classList.add('visible'); cartEl.setAttribute('aria-hidden', 'false'); }
function closeCart() { cartEl.classList.remove('open'); overlay.classList.remove('visible'); cartEl.setAttribute('aria-hidden', 'true'); }

document.querySelector('.catalogue-toolbar').addEventListener('click', event => {
  const button = event.target.closest('[data-filter]'); if (!button) return;
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(filter => filter.classList.toggle('active', filter === button));
  renderCatalogue();
});
productsEl.addEventListener('click', event => {
  const button = event.target.closest('[data-add]'); if (!button) return;
  const product = demoCatalogue.find(item => item.id === button.dataset.add);
  if (product) { cart.push(product); renderCart(); openCart(); }
});
document.querySelector('#cartItems').addEventListener('click', event => {
  const button = event.target.closest('[data-remove]'); if (!button) return;
  cart.splice(Number(button.dataset.remove), 1); renderCart();
});
document.querySelector('#cartButton').addEventListener('click', openCart);
document.querySelector('#closeCart').addEventListener('click', closeCart);
overlay.addEventListener('click', closeCart);
document.querySelector('#checkout').addEventListener('click', () => {
  if (!cart.length) return;
  alert('Demonstração: em produção, este botão cria uma sessão de checkout e gera o PIX pelo provedor configurado.');
});
document.querySelector('#searchForm').addEventListener('submit', event => {
  event.preventDefault();
  document.querySelector('#catalogo').scrollIntoView({ behavior: 'smooth' });
});
renderCatalogue(); renderCart();
