import React, { useState, useEffect } from 'react';
import CountUp from 'react-countup';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';

// Mock data (would come from Firestore)
const mockData = [
  { date: '2024-01', income: 2400, expense: 1800 },
  { date: '2024-02', income: 3000, expense: 2100 },
  { date: '2024-03', income: 2000, expense: 2500 },
  { date: '2024-04', income: 2780, expense: 2000 },
  { date: '2024-05', income: 1890, expense: 2181 },
];

const mockCategories = [
  { name: 'Ocio', y: 45 },
  { name: 'Comida', y: 25 },
  { name: 'Alquiler', y: 20 },
  { name: 'Otros', y: 10 },
];

const App = () => {
  const [movements, setMovements] = useState([]);
  const [totalBalance, setTotalBalance] = useState(1250.45);

  const highchartsOptions = {
    chart: {
      type: 'pie',
      backgroundColor: 'transparent',
      height: 300
    },
    title: { text: '' },
    plotOptions: {
      pie: {
        innerSize: '60%',
        borderWidth: 0,
        dataLabels: {
          enabled: true,
          format: '{point.name}: {point.percentage:.1f}%',
          style: { color: '#94a3b8' }
        }
      }
    },
    series: [{
      name: 'Gastos',
      data: mockCategories,
      colors: ['#6366f1', '#a855f7', '#f43f5e', '#10b981']
    }]
  };

  return (
    <div className="app-wrapper">
      <header className="header">
        <h1>Flowt</h1>
        <p>Tu asistente financiero inteligente</p>
      </header>

      <main className="dashboard-container">
        {/* Status Cards */}
        <section className="glass-card stat-card">
          <span className="stat-label">Saldo Total</span>
          <span className="stat-value">
            <CountUp end={totalBalance} decimals={2} decimal="," separator="." suffix="€" />
          </span>
        </section>

        <section className="glass-card stat-card">
          <span className="stat-label">Ingresos del Mes</span>
          <span className="stat-value income-text">
            <CountUp end={2400} prefix="+" separator="," suffix="€" />
          </span>
        </section>

        <section className="glass-card stat-card">
          <span className="stat-label">Gastos del Mes</span>
          <span className="stat-value expense-text">
            <CountUp end={1850} prefix="-" separator="," suffix="€" />
          </span>
        </section>

        {/* Charts */}
        <div className="glass-card" style={{ gridColumn: 'span 2', padding: '1.5rem' }}>
          <h3>Tendencia de Flujo de Caja</h3>
          <div style={{ width: '100%', height: 300, marginTop: '1rem' }}>
            <ResponsiveContainer>
              <AreaChart data={mockData}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="date" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                  itemStyle={{ color: '#f8fafc' }}
                />
                <Area type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={3} />
                <Area type="monotone" dataKey="expense" stroke="#f43f5e" fillOpacity={0} strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3>Distribución por Categorías</h3>
          <HighchartsReact highcharts={Highcharts} options={highchartsOptions} />
        </div>

        {/* Recent Transactions */}
        <div className="glass-card" style={{ gridColumn: '1 / -1', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3>Movimientos Recientes</h3>
            <button className="btn btn-primary">Ver Todos</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Tipo</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>18/04/2026</td>
                <td>Kinguin Games</td>
                <td><span className="badge badge-expense">GASTO</span></td>
                <td className="expense-text">-4.42€</td>
              </tr>
              <tr>
                <td>17/04/2026</td>
                <td>Nómina Abril</td>
                <td><span className="badge badge-income">INGRESO</span></td>
                <td className="income-text">+2,400.00€</td>
              </tr>
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
};

export default App;
