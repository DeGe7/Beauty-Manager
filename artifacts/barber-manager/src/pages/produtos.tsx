import { useRef, useState } from 'react';
import { useStore, brl, productStatus, Product, PayMethod, ProductSaleDiscountType } from '@/data/store';
import { FeatureInfo } from '@/components/FeatureInfo';
import { formatDateKey } from '@/data/date';
import { calculateProductSaleLine } from '@/data/product-sale';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, Plus, Trash2, Edit2, Check, X, AlertTriangle, ArrowUp, CheckCircle2, ShoppingBag, Minus, ReceiptText, RotateCcw } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useRecentlyAddedIds } from '@/hooks/useRecentlyAddedIds';
import { useTemporaryFormState } from '@/data/form-drafts';

export default function Produtos() {
  const { products, clients, appointments, productSales, recordProductSale, reverseProductSale, addProduct, updateProduct, removeProduct, restock, isLoading } = useStore();
  const recentlyAddedProductIds = useRecentlyAddedIds(products, isLoading);

  const totalItems = products.length;
  const totalValue = products.reduce((s, p) => s + (p.cost * p.stock), 0);
  const okItems = products.filter(p => productStatus(p) === 'ok').length;
  const alertItems = products.filter(p => productStatus(p) !== 'ok').length;
  const prosthesisCount = products.filter(p => p.isProsthesisCapillary).length;

  const productInitialValues = {
    name: '',
    category: '',
    price: '',
    cost: '',
    stock: '',
    minStock: '',
    isProsthesisCapillary: false,
  };
  const [productCreateDraft, setProductCreateDraft, clearProductCreateDraft] = useTemporaryFormState(
    'product-create',
    'produtos',
    { isOpen: false, form: productInitialValues },
  );
  const isAdding = productCreateDraft.isOpen;
  const setIsAdding = (open: boolean) => {
    if (!open) clearProductCreateDraft();
    else setProductCreateDraft(current => ({ ...current, isOpen: true }));
  };
  const [showOnlyProsthesis, setShowOnlyProsthesis] = useState(false);
  const visibleProducts = showOnlyProsthesis
    ? products.filter(p => p.isProsthesisCapillary)
    : products;
  const newP = productCreateDraft.form;
  const setNewP = (update: typeof newP | ((current: typeof newP) => typeof newP)) => {
    setProductCreateDraft(current => ({
      ...current,
      form: typeof update === 'function' ? update(current.form) : update,
    }));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = Number(newP.price);
    const cost = Number(newP.cost);
    const stock = Number(newP.stock || 0);
    const minStock = Number(newP.minStock || 0);
    if (!newP.name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 ||
        !Number.isFinite(stock) || stock < 0 || !Number.isFinite(minStock) || minStock < 0) {
      toast.error('Informe valores válidos e não negativos');
      return;
    }
    if (!await addProduct({
      name: newP.name, category: newP.category || 'Geral', price, cost,
      stock, minStock, isActive: true, isProsthesisCapillary: newP.isProsthesisCapillary,
    })) return;
    toast.success('Produto adicionado');
    clearProductCreateDraft();
  };

  const [productEditDraft, setProductEditDraft, clearProductEditDraft] = useTemporaryFormState(
    'product-edit',
    'produtos',
    { editingId: null as string | null, form: {} as any },
  );
  const editingId = productEditDraft.editingId;
  const editForm = productEditDraft.form;
  const setEditForm = (update: any) => {
    setProductEditDraft(current => ({
      ...current,
      form: typeof update === 'function' ? update(current.form) : update,
    }));
  };
  const startEdit = (p: Product) => setProductEditDraft({ editingId: p.id, form: { ...p } });
  const cancelEdit = () => clearProductEditDraft();
  const saveEdit = async () => {
    const price = Number(editForm.price);
    const cost = Number(editForm.cost);
    const minStock = Number(editForm.minStock);
    if (!editForm.name || !Number.isFinite(price) || price <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(minStock) || minStock < 0) {
      toast.error('Informe valores válidos e não negativos');
      return;
    }
    if (!await updateProduct(editingId!, {
      name: editForm.name,
      category: editForm.category,
      price,
      cost,
      minStock,
      isProsthesisCapillary: Boolean(editForm.isProsthesisCapillary),
    })) return;
    toast.success('Salvo');
    clearProductEditDraft();
  };

  const [restockQs, setRestockQs] = useState<Record<string, string>>({});
  type SaleLine = { key: number; productId: string; quantity: string; discountType: ProductSaleDiscountType; discountValue: string };
  const lineKey = useRef(1);
  const [saleDraft, setSaleDraft, clearSaleDraft] = useTemporaryFormState(
    'product-sale',
    'produtos',
    {
      clientId: '',
      appointmentId: '',
      paymentMethod: 'pix' as PayMethod,
      lines: [{ key: 1, productId: '', quantity: '1', discountType: 'amount', discountValue: '0' }] as SaleLine[],
    },
  );
  const { clientId: saleClientId, appointmentId: saleAppointmentId, paymentMethod, lines: saleLines } = saleDraft;
  const setSaleClientId = (clientId: string) => setSaleDraft(current => ({ ...current, clientId }));
  const setSaleAppointmentId = (appointmentId: string) => setSaleDraft(current => ({ ...current, appointmentId }));
  const setPaymentMethod = (nextMethod: PayMethod) => setSaleDraft(current => ({ ...current, paymentMethod: nextMethod }));
  const setSaleLines = (update: SaleLine[] | ((current: SaleLine[]) => SaleLine[])) => {
    setSaleDraft(current => ({
      ...current,
      lines: typeof update === 'function' ? update(current.lines) : update,
    }));
  };
  const [isSubmittingSale, setIsSubmittingSale] = useState(false);
  const [saleReversalDraft, setSaleReversalDraft, clearSaleReversalDraft] = useTemporaryFormState(
    'product-sale-reversal',
    'produtos',
    { saleId: null as string | null, reason: '' },
  );
  const { saleId: selectedSaleId, reason: reversalReason } = saleReversalDraft;
  const setSelectedSaleId = (saleId: string | null) => setSaleReversalDraft(current => ({ ...current, saleId }));
  const setReversalReason = (reason: string) => setSaleReversalDraft(current => ({ ...current, reason }));
  const [isReversingSale, setIsReversingSale] = useState(false);
  const selectedSale = productSales.find(sale => sale.id === selectedSaleId);
  const selectableProducts = products.filter(product => product.isActive);
  const linkedAppointments = saleClientId
    ? appointments.filter(appointment => appointment.clientId === saleClientId)
    : appointments;
  const getLineAmounts = (line: SaleLine) => {
    const product = products.find(item => item.id === line.productId);
    const quantity = Number(line.quantity);
    const discountValue = Number(line.discountValue);
    if (!product) return { product, subtotal: 0, discount: 0, total: 0, valid: false, error: '' };
    try {
      const calculated = calculateProductSaleLine(product.price, quantity, line.discountType, discountValue);
      return { product, subtotal: calculated.subtotal, discount: calculated.discountAmount, total: calculated.total, valid: true, error: '' };
    } catch (error) {
      const subtotal = product.price * Math.max(0, Number.isFinite(quantity) ? quantity : 0);
      return {
        product,
        subtotal,
        discount: 0,
        total: 0,
        valid: false,
        error: error instanceof Error ? error.message : 'Valores inválidos.',
      };
    }
  };
  const saleTotal = saleLines.reduce((sum, line) => sum + getLineAmounts(line).total, 0);
  const updateSaleLine = (key: number, changes: Partial<SaleLine>) => {
    setSaleLines(current => current.map(line => line.key === key ? { ...line, ...changes } : line));
  };
  const handleSaleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validLines = saleLines.filter(line => line.productId);
    if (!validLines.length) {
      toast.error('Adicione ao menos um produto à venda');
      return;
    }
    if (validLines.some(line => !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1)) {
      toast.error('Informe uma quantidade válida para cada produto');
      return;
    }
    if (validLines.some(line => !Number.isFinite(Number(line.discountValue)) || Number(line.discountValue) < 0)) {
      toast.error('Informe descontos válidos');
      return;
    }
    if (validLines.some(line => !getLineAmounts(line).valid)) {
      toast.error('Confira o desconto e a quantidade de cada item.');
      return;
    }
    setIsSubmittingSale(true);
    try {
      const saved = await recordProductSale({
        date: formatDateKey(),
        ...(saleClientId ? { clientId: saleClientId } : {}),
        ...(saleAppointmentId ? { appointmentId: saleAppointmentId } : {}),
        paymentMethod,
        items: validLines.map(line => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          discountType: line.discountType,
          discountValue: Number(line.discountValue),
        })),
      });
      if (!saved) return;
      toast.success('Venda registrada');
      clearSaleDraft();
    } finally {
      setIsSubmittingSale(false);
    }
  };
  const handleRestock = async (id: string) => {
    const q = Number(restockQs[id]);
    if(q > 0 && await restock(id, q)) { toast.success('Estoque atualizado'); setRestockQs({...restockQs, [id]: ''}); }
  };
  const handleReverseSale = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!selectedSale || reversalReason.trim().length < 3) {
      toast.error('Informe um motivo com pelo menos 3 caracteres.');
      return;
    }
    setIsReversingSale(true);
    try {
      const reversed = await reverseProductSale(selectedSale.id, reversalReason.trim());
      if (!reversed) return;
      toast.success('Estorno registrado. O estoque foi devolvido.');
      clearSaleReversalDraft();
    } finally {
      setIsReversingSale(false);
    }
  };

  return (
    <div className="min-w-0 p-4 sm:p-5 md:p-8 space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Produtos & Estoque</h2>
            <FeatureInfo label="Produtos e estoque">Consulte níveis, cadastre produtos, registre vendas avulsas e reponha itens.</FeatureInfo>
          </div>
        </div>
        {!isAdding && <button onClick={() => setIsAdding(true)} className="min-h-11 w-full md:w-auto justify-center bg-brand-gold text-brand-bg px-4 py-2 rounded-lg text-sm font-bold hover:bg-brand-gold/90 flex items-center gap-2 transition-all"><Plus className="w-4 h-4"/> Adicionar Produto</button>}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="min-w-0 bg-brand-surface border border-brand-border p-3 sm:p-4 rounded-xl"><p className="text-xs text-muted-foreground uppercase">Total Produtos</p><p className="text-2xl font-bold mt-1">{totalItems}</p></div>
        <div className="min-w-0 bg-brand-surface border border-brand-border p-3 sm:p-4 rounded-xl"><p className="text-xs text-muted-foreground uppercase">Valor em Estoque</p><p className="break-words text-xl sm:text-2xl font-bold mt-1 text-brand-gold">{brl(totalValue)}</p></div>
        <div className="min-w-0 bg-brand-surface border border-success/30 p-3 sm:p-4 rounded-xl"><p className="text-xs text-success uppercase">Estoque OK</p><p className="text-2xl font-bold mt-1 text-success">{okItems}</p></div>
        <div className="min-w-0 bg-brand-surface border border-destructive/30 p-3 sm:p-4 rounded-xl"><p className="text-xs text-destructive uppercase">Em Alerta</p><p className="text-2xl font-bold mt-1 text-destructive">{alertItems}</p></div>
      </div>

      <div className={`md:hidden flex items-center gap-3 rounded-2xl border p-4 ${alertItems > 0 ? 'border-destructive/25 bg-destructive/10' : 'border-success/25 bg-success/10'}`}>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${alertItems > 0 ? 'bg-destructive/15 text-destructive' : 'bg-success/15 text-success'}`}>
          {alertItems > 0 ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground">{alertItems > 0 ? `${alertItems} produto${alertItems !== 1 ? 's' : ''} precisam de atenção` : 'Estoque saudável'}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {alertItems > 0 ? `${products.filter(p => productStatus(p) === 'critical').length} crítico(s) e ${products.filter(p => productStatus(p) === 'low').length} baixo(s)` : `Todos os ${totalItems} produtos estão em nível adequado`}
          </p>
        </div>
      </div>

      <section data-testid="product-sale-section" className="overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
        <div className="flex flex-col gap-3 border-b border-brand-border p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/10 text-brand-gold"><ShoppingBag className="h-5 w-5" /></div>
            <div>
              <div className="flex items-center gap-1">
                <h3 className="font-bold text-foreground">Registrar venda de produtos</h3>
                <FeatureInfo label="Venda de produtos">Registre produtos sem precisar lançar um atendimento. Cliente e agendamento são opcionais.</FeatureInfo>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-brand-gold/30 bg-brand-gold/5 px-4 py-2 text-left sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total da venda</p>
            <p data-testid="product-sale-total" className="text-xl font-bold tabular-nums text-brand-gold">{brl(saleTotal)}</p>
          </div>
        </div>
        <form onSubmit={handleSaleSubmit} className="space-y-5 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="block text-xs font-semibold text-muted-foreground">
              Data da venda
              <input data-testid="product-sale-date" type="date" value={formatDateKey()} readOnly aria-readonly="true" className="mt-1.5 min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 text-sm text-foreground outline-none" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              Cliente <span className="font-normal">(opcional)</span>
              <select data-testid="product-sale-client" value={saleClientId} onChange={event => { setSaleClientId(event.target.value); setSaleAppointmentId(''); }} className="mt-1.5 min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 text-sm text-foreground outline-none focus:border-brand-gold">
                <option value="">Venda sem cliente</option>
                {clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              Agendamento <span className="font-normal">(opcional)</span>
              <select data-testid="product-sale-appointment" value={saleAppointmentId} onChange={event => setSaleAppointmentId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 text-sm text-foreground outline-none focus:border-brand-gold">
                <option value="">Sem agendamento</option>
                {linkedAppointments.map(appointment => (
                  <option key={appointment.id} value={appointment.id}>{appointment.date} · {appointment.time} · {appointment.client} — {appointment.service}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">
              Forma de pagamento
              <select data-testid="product-sale-payment-method" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PayMethod)} className="mt-1.5 min-h-11 w-full rounded-lg border border-brand-border bg-brand-bg px-3 text-sm text-foreground outline-none focus:border-brand-gold">
                <option value="pix">PIX</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="debito">Débito</option>
                <option value="credito">Crédito</option>
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1">
                  <h4 className="text-sm font-bold text-foreground">Itens da venda</h4>
                  <FeatureInfo label="Desconto por produto">Escolha desconto em reais ou percentual para cada item. O total da linha considera preço, quantidade e desconto.</FeatureInfo>
                </div>
              </div>
              <button type="button" data-testid="product-sale-add-item" disabled={!selectableProducts.length} onClick={() => setSaleLines(current => [...current, { key: ++lineKey.current, productId: '', quantity: '1', discountType: 'amount', discountValue: '0' }])} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-brand-border px-3 text-xs font-semibold text-brand-gold hover:bg-brand-gold/10 disabled:cursor-not-allowed disabled:opacity-50">
                <Plus className="h-4 w-4" /> Adicionar item
              </button>
            </div>
            {!selectableProducts.length && (
              <div className="rounded-xl border border-dashed border-brand-border px-4 py-5 text-center text-sm text-muted-foreground">
                Nenhum produto ativo disponível para venda.
              </div>
            )}
            <div className="space-y-2">
              {saleLines.map((line, index) => {
                const amounts = getLineAmounts(line);
                return (
                  <div key={line.key} data-testid={`product-sale-item-${line.key}`} className="grid grid-cols-2 gap-3 rounded-xl border border-brand-border bg-brand-bg/60 p-3 sm:grid-cols-12 sm:items-end sm:gap-2">
                    <label className="col-span-2 block text-[11px] font-semibold text-muted-foreground sm:col-span-4">
                      Produto {index + 1}
                      <select data-testid={`product-sale-product-${line.key}`} value={line.productId} onChange={event => updateSaleLine(line.key, { productId: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-3 text-sm text-foreground outline-none focus:border-brand-gold">
                        <option value="">Selecione um produto</option>
                        {selectableProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {brl(product.price)}</option>)}
                      </select>
                    </label>
                    <div className="col-span-1 text-[11px] font-semibold text-muted-foreground sm:col-span-2">
                      Preço unitário
                      <p data-testid={`product-sale-unit-price-${line.key}`} className="mt-1 flex min-h-11 items-center text-sm font-bold tabular-nums text-foreground">{amounts.product ? brl(amounts.product.price) : '—'}</p>
                    </div>
                    <label className="col-span-1 block text-[11px] font-semibold text-muted-foreground sm:col-span-1">
                      Qtd.
                      <input data-testid={`product-sale-quantity-${line.key}`} type="number" min="1" step="1" inputMode="numeric" value={line.quantity} onChange={event => updateSaleLine(line.key, { quantity: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-2 text-sm text-foreground outline-none focus:border-brand-gold" />
                    </label>
                    <label className="col-span-1 block text-[11px] font-semibold text-muted-foreground sm:col-span-2">
                      Desconto
                      <select data-testid={`product-sale-discount-type-${line.key}`} value={line.discountType} onChange={event => updateSaleLine(line.key, { discountType: event.target.value as ProductSaleDiscountType })} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-2 text-sm text-foreground outline-none focus:border-brand-gold">
                        <option value="amount">Valor R$</option>
                        <option value="percent">Percentual %</option>
                      </select>
                    </label>
                    <label className="col-span-1 block text-[11px] font-semibold text-muted-foreground sm:col-span-1">
                      Valor
                      <input data-testid={`product-sale-discount-value-${line.key}`} type="number" min="0" max={line.discountType === 'percent' ? 100 : amounts.product ? amounts.subtotal : undefined} step="0.01" inputMode="decimal" value={line.discountValue} onChange={event => updateSaleLine(line.key, { discountValue: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-brand-border bg-brand-surface px-2 text-sm text-foreground outline-none focus:border-brand-gold" />
                    </label>
                    <div className="col-span-1 min-w-0 text-[11px] font-semibold text-muted-foreground sm:col-span-1">
                      Total item
                      <p data-testid={`product-sale-line-total-${line.key}`} className="mt-1 flex min-h-11 items-center break-words text-sm font-bold tabular-nums text-brand-gold">{brl(amounts.total)}</p>
                      {!amounts.valid && amounts.error && (
                        <p className="col-span-full text-xs text-destructive" role="alert">{amounts.error}</p>
                      )}
                    </div>
                    <button type="button" data-testid={`product-sale-remove-item-${line.key}`} aria-label={`Remover item ${index + 1}`} disabled={saleLines.length === 1} onClick={() => setSaleLines(current => current.filter(item => item.key !== line.key))} className="col-span-1 flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 sm:col-span-1">
                      <Minus className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col-reverse gap-3 border-t border-brand-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <FeatureInfo label="Cálculo da venda">Preço unitário e total são calculados automaticamente para cada item.</FeatureInfo>
            <button data-testid="product-sale-submit" type="submit" disabled={isSubmittingSale || !selectableProducts.length || !saleLines.some(line => line.productId)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-gold px-5 text-sm font-bold text-brand-bg hover:bg-brand-gold/90 disabled:cursor-not-allowed disabled:opacity-50">
              {isSubmittingSale ? <><span className="h-4 w-4 animate-pulse rounded-full border-2 border-brand-bg/30 border-t-brand-bg" /> Registrando venda…</> : <><Check className="h-4 w-4" /> Registrar venda</>}
            </button>
          </div>
        </form>
      </section>

      <section data-testid="product-sales-history" className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-bg text-muted-foreground"><ReceiptText className="h-4 w-4" /></div>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="font-bold text-foreground">Vendas recentes</h3>
              <FeatureInfo label="Histórico de vendas">Mostra as vendas registradas e os valores praticados.</FeatureInfo>
            </div>
          </div>
        </div>
        {isLoading ? (
          <div className="space-y-2" aria-label="Carregando vendas recentes">{[0, 1].map(index => <Skeleton key={index} className="h-16 w-full" />)}</div>
        ) : productSales.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brand-border px-4 py-8 text-center">
            <ReceiptText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">Nenhuma venda registrada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...productSales].sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)).slice(0, 8).map(sale => (
              <article key={sale.id} data-testid={`product-sale-snapshot-${sale.id}`} className="rounded-xl border border-brand-border/80 bg-brand-bg/50 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-brand-border/70 pb-2">
                  <p data-testid={`product-sale-snapshot-date-${sale.id}`} className="text-xs font-semibold text-muted-foreground">{new Date(`${sale.date}T12:00:00`).toLocaleDateString('pt-BR')}</p>
                  <div className="flex items-center gap-3 text-xs">
                    <span data-testid={`product-sale-snapshot-method-${sale.id}`} className="rounded-full bg-brand-surface px-2.5 py-1 font-medium text-foreground">{({ pix: 'PIX', dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito' })[sale.paymentMethod]}</span>
                    {sale.reversalDate && <span data-testid={`product-sale-reversed-status-${sale.id}`} className="rounded-full bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">Estornada</span>}
                    <span className="text-muted-foreground">Total original</span>
                    <strong data-testid={`product-sale-snapshot-total-${sale.id}`} className="text-sm tabular-nums text-brand-gold">{brl(sale.total)}</strong>
                  </div>
                </div>
                <div className="divide-y divide-brand-border/50">
                  {sale.items.map((item, index) => (
                    <div key={`${sale.id}-${item.productId}-${index}`} data-testid={`product-sale-snapshot-item-${sale.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-2 text-xs sm:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(70px,auto))] sm:items-center">
                      <p className="min-w-0 break-words font-semibold text-foreground">{item.productName}</p>
                      <span className="text-right tabular-nums text-muted-foreground sm:text-left">{brl(item.unitPrice)} / un.</span>
                      <span className="text-muted-foreground">Qtd. <strong className="text-foreground">{item.quantity}</strong></span>
                      <span className="text-muted-foreground">Desc. <strong className="text-foreground">{item.discountAmount > 0 ? `${brl(item.discountAmount)}${item.discountType === 'percent' ? ` (${item.discountValue}%)` : ''}` : '—'}</strong></span>
                      <span className="text-right font-bold tabular-nums text-foreground sm:text-left">{brl(item.total)}</span>
                    </div>
                  ))}
                </div>
                {sale.reversalDate ? (
                  <div data-testid={`product-sale-reversal-${sale.id}`} className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs">
                    <p className="font-semibold text-destructive">Estorno em {new Date(`${sale.reversalDate}T12:00:00`).toLocaleDateString('pt-BR')} · {brl(sale.total)}</p>
                    <p className="mt-1 break-words text-muted-foreground">Motivo: {sale.reversalReason || 'Não informado'}</p>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid={`product-sale-reverse-${sale.id}`}
                    onClick={() => setSaleReversalDraft({ saleId: sale.id, reason: '' })}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Estornar venda
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <AlertDialog
        open={Boolean(selectedSale)}
        onOpenChange={open => {
          if (!open && !isReversingSale) clearSaleReversalDraft();
          else if (open) setSaleReversalDraft(current => ({ ...current, saleId: selectedSaleId }));
        }}
      >
        <AlertDialogContent className="border-brand-border bg-brand-surface text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar estorno da venda?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedSale
                ? `O valor de ${brl(selectedSale.total)} será lançado como estorno e ${selectedSale.items.reduce((sum, item) => sum + item.quantity, 0)} unidade(s) voltarão ao estoque. O registro original será preservado.`
                : 'O registro original será preservado.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            Motivo do estorno
            <textarea
              data-testid="product-sale-reversal-reason"
              value={reversalReason}
              onChange={event => setReversalReason(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Descreva por que a venda está sendo estornada"
              className="w-full resize-y rounded-lg border border-brand-border bg-brand-bg p-3 text-sm outline-none focus:border-brand-gold"
            />
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReversingSale} className="border-brand-border bg-brand-bg">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              data-testid="product-sale-reversal-confirm"
              disabled={isReversingSale || reversalReason.trim().length < 3}
              onClick={handleReverseSale}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isReversingSale ? 'Estornando…' : 'Confirmar estorno'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isAdding && (
        <div className="bg-brand-bg border border-brand-gold p-4 sm:p-5 rounded-xl shadow-[0_0_15px_rgba(201,168,76,0.1)]">
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-7 gap-4 items-end [&_input:not([type=checkbox])]:min-h-11">
            <div className="md:col-span-2"><label className="text-[10px] uppercase text-muted-foreground">Nome</label><input required type="text" value={newP.name} onChange={e=>setNewP({...newP,name:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" autoFocus/></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Categoria</label><input type="text" value={newP.category} onChange={e=>setNewP({...newP,category:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Preço Venda (R$)</label><input required type="number" step="0.01" value={newP.price} onChange={e=>setNewP({...newP,price:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Custo (R$)</label><input required type="number" step="0.01" value={newP.cost} onChange={e=>setNewP({...newP,cost:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Estoque Inicial</label><input type="number" value={newP.stock} onChange={e=>setNewP({...newP,stock:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
            <div><label className="text-[10px] uppercase text-muted-foreground">Estoque Min.</label><input type="number" value={newP.minStock} onChange={e=>setNewP({...newP,minStock:e.target.value})} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
            <label className="md:col-span-2 flex min-h-11 items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={newP.isProsthesisCapillary}
                onChange={e => setNewP({ ...newP, isProsthesisCapillary: e.target.checked })}
                className="h-4 w-4 accent-brand-gold"
              />
              Custo de prótese capilar
            </label>
            <div className="md:col-span-7 flex flex-col-reverse sm:flex-row justify-end gap-2 mt-2">
              <button type="button" onClick={()=>setIsAdding(false)} className="min-h-11 px-4 py-2 text-sm hover:bg-brand-surface rounded">Cancelar</button>
              <button type="submit" className="min-h-11 bg-brand-gold text-brand-bg px-6 py-2 rounded text-sm font-bold">Salvar Produto</button>
            </div>
          </form>
        </div>
      )}

      <div className="min-w-0 bg-brand-surface border border-brand-border rounded-2xl p-3 sm:p-6">
        {isLoading ? <div className="space-y-3">{Array.from({length: 5}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div> : products.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground"><Package className="w-12 h-12 mx-auto mb-4 opacity-30"/><p>Nenhum produto</p></div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar produtos">
              <button
                type="button"
                data-testid="filter-all-products"
                aria-pressed={!showOnlyProsthesis}
                onClick={() => setShowOnlyProsthesis(false)}
                className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  !showOnlyProsthesis
                    ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                    : 'border-brand-border text-muted-foreground hover:bg-brand-bg'
                }`}
              >
                Todos os produtos ({totalItems})
              </button>
              <button
                type="button"
                data-testid="filter-prosthesis-products"
                aria-pressed={showOnlyProsthesis}
                onClick={() => setShowOnlyProsthesis(true)}
                className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  showOnlyProsthesis
                    ? 'border-brand-gold bg-brand-gold/10 text-brand-gold'
                    : 'border-brand-border text-muted-foreground hover:bg-brand-bg'
                }`}
              >
                Próteses capilares ({prosthesisCount})
              </button>
            </div>
            {visibleProducts.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Package className="mx-auto mb-3 h-10 w-10 opacity-30" />
                <p>Nenhum produto marcado como prótese capilar.</p>
                <button
                  type="button"
                  onClick={() => setShowOnlyProsthesis(false)}
                  className="mt-3 min-h-11 rounded-lg px-4 py-2 text-sm font-medium text-brand-gold hover:bg-brand-bg"
                >
                  Mostrar todos os produtos
                </button>
              </div>
            ) : (
              <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead><tr className="border-b border-brand-border text-muted-foreground"><th className="pb-3">Produto</th><th className="pb-3">Categoria</th><th className="pb-3">Prótese capilar</th><th className="pb-3">Venda</th><th className="pb-3">Custo</th><th className="pb-3">Margem</th><th className="pb-3">Estoque</th><th className="pb-3">Reposição</th><th className="pb-3 text-right">Ações</th></tr></thead>
                <tbody>
                  {visibleProducts.map(p => {
                    const isEd = editingId === p.id;
                    const st = productStatus(p);
                    const stClass = st === 'critical' ? 'text-destructive bg-destructive/10' : st === 'low' ? 'text-warning bg-warning/10' : 'text-success bg-success/10';
                     const margem = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : null;
                    return (
                      <tr key={p.id} className={`border-b border-brand-border/50 hover:bg-brand-bg/50 transition-colors ${recentlyAddedProductIds.has(p.id) ? 'bm-list-item-enter' : ''}`}>
                        <td className="py-3">{isEd ? <input className="bg-brand-bg border border-brand-border rounded px-2 py-1 w-32 outline-none" value={editForm.name} onChange={e=>setEditForm({...editForm,name:e.target.value})} /> : <span className="font-medium">{p.name}</span>}</td>
                        <td className="py-3">{isEd ? <input className="bg-brand-bg border border-brand-border rounded px-2 py-1 w-24 outline-none" value={editForm.category} onChange={e=>setEditForm({...editForm,category:e.target.value})} /> : <span className="text-muted-foreground">{p.category}</span>}</td>
                        <td className="py-3">
                          {isEd ? (
                            <input
                              type="checkbox"
                              aria-label={`Marcar ${p.name} como prótese capilar`}
                              checked={Boolean(editForm.isProsthesisCapillary)}
                              onChange={e => setEditForm({ ...editForm, isProsthesisCapillary: e.target.checked })}
                              className="h-4 w-4 accent-brand-gold"
                            />
                          ) : p.isProsthesisCapillary ? (
                            <span className="rounded bg-brand-gold/10 px-2 py-1 text-xs font-medium text-brand-gold">Sim</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-3">{isEd ? <input type="number" className="bg-brand-bg border border-brand-border rounded px-2 py-1 w-20 outline-none" value={editForm.price} onChange={e=>setEditForm({...editForm,price:e.target.value})} /> : brl(p.price)}</td>
                        <td className="py-3">{isEd ? <input type="number" className="bg-brand-bg border border-brand-border rounded px-2 py-1 w-20 outline-none" value={editForm.cost} onChange={e=>setEditForm({...editForm,cost:e.target.value})} /> : brl(p.cost)}</td>
                         <td className="py-3 text-muted-foreground">{margem === null ? '—' : `${Math.round(margem)}%`}</td>
                        <td className="py-3">
                          <span className={`px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap ${stClass}`}>
                            {p.stock} {isEd ? <> / <input type="number" className="bg-brand-bg border border-brand-border rounded px-1 py-0.5 w-12 outline-none inline text-foreground ml-1" value={editForm.minStock} onChange={e=>setEditForm({...editForm,minStock:e.target.value})} /></> : <span className="opacity-70 font-normal">/ min {p.minStock}</span>}
                          </span>
                        </td>
                        <td className="py-3">
                          {!isEd && (
                            <div className="flex items-center gap-1">
                              <input type="number" min="1" placeholder="+Qtd" value={restockQs[p.id]||''} onChange={e=>setRestockQs({...restockQs, [p.id]: e.target.value})} className="bg-brand-bg border border-brand-border rounded px-2 py-1 w-16 text-xs outline-none" />
                              <button aria-label="Repor estoque" onClick={()=>handleRestock(p.id)} className="p-1 bg-brand-gold/10 text-brand-gold rounded hover:bg-brand-gold hover:text-brand-bg transition-all hover:scale-105"><ArrowUp className="w-3.5 h-3.5"/></button>
                            </div>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {isEd ? (
                            <div className="flex justify-end gap-1">
                              <button aria-label="Confirmar edição" onClick={saveEdit} className="p-1.5 text-success hover:bg-success/10 rounded transition-all hover:scale-105"><Check className="w-4 h-4"/></button>
                              <button aria-label="Cancelar edição" onClick={cancelEdit} className="p-1.5 text-muted-foreground hover:bg-brand-bg rounded transition-all hover:scale-105"><X className="w-4 h-4"/></button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button aria-label={`Editar ${p.name}`} onClick={()=>startEdit(p)} className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-brand-bg rounded transition-all hover:scale-105"><Edit2 className="w-4 h-4"/></button>
                              <AlertDialog><AlertDialogTrigger asChild><button aria-label={`Excluir ${p.name}`} className="p-1.5 text-destructive hover:bg-destructive/10 rounded transition-all hover:scale-105"><Trash2 className="w-4 h-4"/></button></AlertDialogTrigger><AlertDialogContent className="bg-brand-surface border-brand-border text-foreground"><AlertDialogHeader><AlertDialogTitle>Excluir produto?</AlertDialogTitle><AlertDialogDescription>Deseja excluir este produto?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white" onClick={async()=>{if(await removeProduct(p.id)) toast.success('Excluído');}}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {visibleProducts.map(p => {
                const st = productStatus(p);
                const stClass = st === 'critical' ? 'text-destructive bg-destructive/10' : st === 'low' ? 'text-warning bg-warning/10' : 'text-success bg-success/10';
                 const margem = p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : null;
                const stockColor = st === 'critical' ? 'bg-destructive' : st === 'low' ? 'bg-warning' : 'bg-success';
                const stockRatio = Math.min(p.stock / (Math.max(p.stock, p.minStock) * 1.5 || 5), 1) * 100;
                return editingId === p.id ? (
                  <div key={p.id} className="min-w-0 p-3 sm:p-4 bg-brand-bg border border-brand-gold rounded-xl">
                    <form onSubmit={event => { event.preventDefault(); void saveEdit(); }} className="grid grid-cols-1 sm:grid-cols-2 gap-3 [&_input:not([type=checkbox])]:min-h-11">
                      <div className="sm:col-span-2"><label className="text-xs uppercase text-muted-foreground">Produto</label><input value={editForm.name ?? ''} onChange={event => setEditForm({ ...editForm, name: event.target.value })} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
                      <div className="sm:col-span-2"><label className="text-xs uppercase text-muted-foreground">Categoria</label><input value={editForm.category ?? ''} onChange={event => setEditForm({ ...editForm, category: event.target.value })} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
                      <label className="sm:col-span-2 flex min-h-11 items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(editForm.isProsthesisCapillary)}
                          onChange={event => setEditForm({ ...editForm, isProsthesisCapillary: event.target.checked })}
                          className="h-4 w-4 accent-brand-gold"
                        />
                        Custo de prótese capilar
                      </label>
                      <div><label className="text-xs uppercase text-muted-foreground">Preço de venda</label><input type="number" value={editForm.price ?? ''} onChange={event => setEditForm({ ...editForm, price: event.target.value })} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
                      <div><label className="text-xs uppercase text-muted-foreground">Custo</label><input type="number" value={editForm.cost ?? ''} onChange={event => setEditForm({ ...editForm, cost: event.target.value })} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
                      <div><label className="text-xs uppercase text-muted-foreground">Estoque mínimo</label><input type="number" value={editForm.minStock ?? ''} onChange={event => setEditForm({ ...editForm, minStock: event.target.value })} className="w-full bg-brand-surface border border-brand-border rounded px-3 py-2 text-sm outline-none" /></div>
                      <div className="flex items-end gap-2">
                        <button type="button" onClick={cancelEdit} className="min-h-11 flex-1 rounded border border-brand-border px-3 py-2 text-sm">Cancelar</button>
                        <button type="submit" className="min-h-11 flex-1 rounded bg-brand-gold px-3 py-2 text-sm font-bold text-brand-bg">Salvar</button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div data-testid={`mobile-product-card-${p.id}`} key={p.id} className={`min-w-0 p-3 sm:p-4 bg-brand-bg border border-brand-border rounded-xl border-l-[3px] ${st === 'critical' ? 'border-l-destructive' : st === 'low' ? 'border-l-warning' : 'border-l-success'} ${recentlyAddedProductIds.has(p.id) ? 'bm-list-item-enter' : ''}`}>
                    <div className="flex min-w-0 justify-between items-start gap-2 mb-3">
                      <div className="min-w-0">
                        <p data-testid={`mobile-product-name-${p.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] font-bold text-sm">{p.name}</p>
                        <p data-testid={`mobile-product-category-${p.id}`} className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">
                          {p.category}{p.isProsthesisCapillary ? ' · prótese capilar' : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${stClass}`}>{p.stock} un.</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mb-3">
                      <div className="min-w-0"><p className="text-muted-foreground">Venda</p><p className="font-bold break-words">{brl(p.price)}</p></div>
                      <div className="min-w-0"><p className="text-muted-foreground">Custo</p><p className="font-bold break-words">{brl(p.cost)}</p></div>
                       <div><p className="text-muted-foreground">Margem</p><p className="font-bold">{margem === null ? '—' : `${Math.round(margem)}%`}</p></div>
                    </div>
                    <div className="mb-3">
                      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Nível de estoque</span>
                        <span>{p.stock} / {p.minStock} mín.</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-brand-surface">
                        <div className={`h-full rounded-full ${stockColor}`} style={{ width: `${stockRatio}%` }} />
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-2 border-t border-brand-border/50">
                      <div className="flex items-center gap-1">
                        <input type="number" min="1" placeholder="+Qtd" aria-label={`Quantidade para repor ${p.name}`} value={restockQs[p.id]||''} onChange={e=>setRestockQs({...restockQs, [p.id]: e.target.value})} className="min-h-11 w-20 bg-brand-surface border border-brand-border rounded px-2 py-1 text-xs outline-none" />
                        <button aria-label={`Repor estoque de ${p.name}`} onClick={()=>handleRestock(p.id)} className="flex min-h-11 min-w-11 items-center justify-center bg-brand-gold/10 text-brand-gold rounded hover:bg-brand-gold hover:text-brand-bg transition-all"><ArrowUp className="w-4 h-4"/></button>
                      </div>
                      <div className="flex gap-1">
                        <button aria-label={`Editar ${p.name}`} onClick={()=>startEdit(p)} className="flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-brand-surface rounded transition-all hover:scale-105"><Edit2 className="w-4 h-4"/></button>
                        <AlertDialog><AlertDialogTrigger asChild><button aria-label={`Excluir ${p.name}`} className="flex min-h-11 min-w-11 items-center justify-center text-destructive hover:bg-destructive/10 rounded transition-all hover:scale-105"><Trash2 className="w-4 h-4"/></button></AlertDialogTrigger><AlertDialogContent className="bg-brand-surface border-brand-border text-foreground"><AlertDialogHeader><AlertDialogTitle>Excluir produto?</AlertDialogTitle><AlertDialogDescription>Deseja excluir?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel className="bg-brand-bg border-brand-border text-foreground">Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white" onClick={async()=>{if(await removeProduct(p.id)) toast.success('Excluído');}}>Excluir</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
