'use client'

import { TrendingUp, BarChart3, Layers, DollarSign } from 'lucide-react'

interface AnalyticsData {
  total_listings: number
  total_acres_sold: number
  total_sale_amount: number
}

interface PortalKPICardsProps {
  data: AnalyticsData | null
  loading: boolean
  countyLabel?: string
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M'
  if (amount >= 1000) return '$' + Math.round(amount / 1000).toLocaleString() + 'K'
  return '$' + Math.round(amount).toLocaleString()
}

function formatNumber(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toLocaleString()
}

export default function PortalKPICards({ data, loading, countyLabel }: PortalKPICardsProps) {
  const avgPPA = data && data.total_acres_sold > 0
    ? data.total_sale_amount / data.total_acres_sold
    : 0

  const cards = [
    {
      label: 'Avg $/Acre',
      value: avgPPA > 0 ? formatCurrency(avgPPA) : '—',
      icon: <DollarSign size={14} />,
    },
    {
      label: 'Total Sales',
      value: data ? data.total_listings.toString() : '—',
      icon: <BarChart3 size={14} />,
    },
    {
      label: 'Acres Sold',
      value: data ? formatNumber(data.total_acres_sold) : '—',
      icon: <Layers size={14} />,
    },
    {
      label: 'Volume',
      value: data ? formatCurrency(data.total_sale_amount) : '—',
      icon: <TrendingUp size={14} />,
    },
  ]

  return (
    <div className="fixed bottom-4 left-4 z-[300] flex gap-2">
      {countyLabel && (
        <div className="bg-black/50 backdrop-blur-xl rounded-xl px-3 py-2.5 border border-white/10 flex items-center">
          <span className="text-[10px] uppercase tracking-wider text-gg-pink font-medium">{countyLabel}</span>
        </div>
      )}
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-black/50 backdrop-blur-xl rounded-xl px-3.5 py-2.5 border border-white/10 min-w-[100px]"
        >
          <div className="flex items-center gap-1.5 text-gg-gray-400 mb-0.5">
            {card.icon}
            <span className="text-[10px] uppercase tracking-wider">{card.label}</span>
          </div>
          <div className="text-lg font-bold">
            {loading ? (
              <div className="h-5 w-16 bg-white/5 rounded animate-pulse" />
            ) : (
              card.value
            )}
          </div>
        </div>
      ))}
    </div>
  )
}