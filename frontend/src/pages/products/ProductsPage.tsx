import React from 'react';
import { useSearchParams } from 'react-router-dom';
import ProductList from './ProductList';
import CategoryList from '../categories/CategoryList';
import BrandList from '../brands/BrandList';

const TABS = [
  { label: 'Products', key: 'products' },
  { label: 'Categories', key: 'categories' },
  { label: 'Brands', key: 'brands' },
];

export default function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'products';

  const setTab = (key: string) => {
    setSearchParams(key === 'products' ? {} : { tab: key });
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'categories': return <CategoryList />;
      case 'brands': return <BrandList />;
      default: return <ProductList />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <div className="flex gap-1 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {renderTab()}
    </div>
  );
}
