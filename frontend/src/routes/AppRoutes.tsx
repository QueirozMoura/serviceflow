import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Login } from '../pages/auth/Login';
import { Dashboard } from '../pages/dashboard/Dashboard';
import { CustomerList } from '../pages/customers/CustomerList';
import { CustomerForm } from '../pages/customers/CustomerForm';
import { CustomerDetails } from '../pages/customers/CustomerDetails';
import { EquipmentList } from '../pages/equipment/EquipmentList';
import { EquipmentForm } from '../pages/equipment/EquipmentForm';
import { EquipmentDetails } from '../pages/equipment/EquipmentDetails';
import { ServiceOrderList } from '../pages/service-orders/ServiceOrderList';
import { ServiceOrderForm } from '../pages/service-orders/ServiceOrderForm';
import { ServiceOrderDetails } from '../pages/service-orders/ServiceOrderDetails';
import { ProtectedRoute, PublicRoute } from './ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicRoute />}><Route path="/login" element={<Login />} /></Route>
      <Route element={<ProtectedRoute />}><Route element={<AppLayout />}><Route path="/dashboard" element={<Dashboard />} /></Route></Route>
      <Route element={<ProtectedRoute />}><Route element={<AppLayout />}>
        <Route path="/customers" element={<CustomerList />} />
        <Route path="/customers/new" element={<CustomerForm />} />
        <Route path="/customers/:id" element={<CustomerDetails />} />
        <Route path="/customers/:id/edit" element={<CustomerForm />} />
        <Route path="/equipment" element={<EquipmentList />} />
        <Route path="/equipment/new" element={<EquipmentForm />} />
        <Route path="/equipment/:id" element={<EquipmentDetails />} />
        <Route path="/equipment/:id/edit" element={<EquipmentForm />} />
        <Route path="/service-orders" element={<ServiceOrderList />} />
        <Route path="/service-orders/new" element={<ServiceOrderForm />} />
        <Route path="/service-orders/:id" element={<ServiceOrderDetails />} />
        <Route path="/service-orders/:id/edit" element={<ServiceOrderForm />} />
      </Route></Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
