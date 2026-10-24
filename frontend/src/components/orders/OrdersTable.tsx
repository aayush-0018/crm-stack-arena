import { useNavigate } from 'react-router-dom';
import { formatDate } from '../../lib/date';
import { formatINR } from '../../lib/money';
import type { OrderListItem } from '../../types';
import CustomerHoverCard from '../customers/CustomerHoverCard';
import DataTable, { Column, SortState } from '../data/DataTable';
import Avatar from '../ui/Avatar';
import { PaymentBadge, StatusBadge } from '../ui/Badge';

export function orderColumns(showCustomer: boolean): Column<OrderListItem>[] {
  return [
    {
      key: 'order',
      header: 'Order',
      sortKey: 'number',
      cell: (o) => (
        <span>
          <span className="font-medium text-ink">{o.orderNumber}</span>
          <span className="ml-2 text-[12.5px] text-ink-3">{o.itemCount} item{o.itemCount === 1 ? '' : 's'}</span>
        </span>
      ),
    },
    ...(showCustomer
      ? [
          {
            key: 'customer',
            header: 'Customer',
            cell: (o: OrderListItem) => (
              <CustomerHoverCard customerId={o.customerId}>
                <span className="flex items-center gap-2.5">
                  <Avatar name={o.customerName} />
                  <span className="truncate hover:underline">{o.customerName}</span>
                </span>
              </CustomerHoverCard>
            ),
          } as Column<OrderListItem>,
        ]
      : []),
    { key: 'date', header: 'Date', sortKey: 'date', optional: true, hideBelow: 'sm', cell: (o) => <span className="text-ink-2">{formatDate(o.orderDate)}</span> },
    { key: 'status', header: 'Status', optional: true, hideBelow: 'md', cell: (o) => <StatusBadge status={o.status} /> },
    { key: 'payment', header: 'Payment', optional: true, cell: (o) => <PaymentBadge status={o.paymentStatus} /> },
    {
      key: 'due',
      header: 'Due',
      align: 'right',
      optional: true,
      hideBelow: 'lg',
      cell: (o) => <span className="text-ink-2">{o.totalPaise - o.amountPaidPaise > 0 ? formatINR(o.totalPaise - o.amountPaidPaise) : '—'}</span>,
    },
    { key: 'total', header: 'Total', sortKey: 'total', align: 'right', cell: (o) => <span className="text-ink">{formatINR(o.totalPaise)}</span> },
  ];
}

export default function OrdersTable({
  orders,
  showCustomer = true,
  hidden,
  sort,
  onSort,
  selected,
  onSelectedChange,
  dim,
}: {
  orders: OrderListItem[];
  showCustomer?: boolean;
  hidden?: Set<string>;
  sort?: SortState;
  onSort?: (key: string) => void;
  selected?: Set<number | string>;
  onSelectedChange?: (s: Set<number | string>) => void;
  dim?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <DataTable
      label="Orders"
      rows={orders}
      columns={orderColumns(showCustomer)}
      rowKey={(o) => o.id}
      hidden={hidden}
      sort={sort}
      onSort={onSort}
      selected={selected}
      onSelectedChange={onSelectedChange}
      onRowClick={(o) => navigate(`/orders/${o.id}`)}
      dim={dim}
    />
  );
}
