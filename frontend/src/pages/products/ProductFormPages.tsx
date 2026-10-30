import { useNavigate, useParams } from 'react-router-dom';
import { productsApi } from '../../api/endpoints';
import { ProductForm } from '../../components/products/ProductParts';
import BackButton from '../../components/ui/BackButton';
import Card from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { PageTop } from '../../components/ui/Tabs';
import { useToast } from '../../context/ToastContext';
import { useAsync } from '../../lib/hooks';

export function ProductCreatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <>
      <PageTop leading={<BackButton to="/products" label="Back to products" />} title="Add product" />
      <div className="max-w-3xl px-4 py-6 sm:px-6">
        <Card title="Product details">
          <ProductForm
            submitLabel="Save product"
            onCancel={() => navigate(-1)}
            onSaved={(p) => {
              toast('success', `${p.name} added`);
              navigate(`/products/${p.id}`, { replace: true });
            }}
          />
        </Card>
      </div>
    </>
  );
}

export function ProductEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const product = useAsync(() => productsApi.get(id), [id]);
  if (product.loading && !product.data) return <LoadingState />;
  if (product.error || !product.data) return <ErrorState error={product.error ?? 'Not found'} onRetry={product.reload} />;
  const p = product.data;
  return (
    <>
      <PageTop leading={<BackButton to={`/products/${p.id}`} label="Back to product" />} title={`Edit ${p.name}`} />
      <div className="max-w-3xl px-4 py-6 sm:px-6">
        <Card title="Product details" actions={<span className="text-[12.5px] text-ink-3">Past orders and invoices keep their own name and price</span>}>
          <ProductForm
            product={p}
            submitLabel="Save changes"
            onCancel={() => navigate(`/products/${p.id}`)}
            onSaved={(saved) => {
              toast('success', 'Product updated');
              navigate(`/products/${saved.id}`, { replace: true });
            }}
          />
        </Card>
      </div>
    </>
  );
}
