import { useEffect, useRef } from 'react';
import { Line } from 'recharts';
import { LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ElevationPoint } from '@shared/gpx-utils';

interface ElevationProfileProps {
  elevationProfile: ElevationPoint[];
  className?: string;
}

export default function ElevationProfile({ elevationProfile, className }: ElevationProfileProps) {
  if (!elevationProfile || elevationProfile.length === 0) {
    return (
      <div className={`${className} flex items-center justify-center bg-gray-50 rounded`}>
        <p className="text-gray-500">No elevation data available</p>
      </div>
    );
  }

  // Prepare data for the chart
  const chartData = elevationProfile.map((point, index) => ({
    distance: Math.round(point.distance * 100) / 100, // Round to 2 decimal places
    elevation: Math.round(point.elevation),
    index,
  }));

  // Custom tooltip formatter
  const customTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
          <p className="text-sm font-medium">{`Distance: ${label} miles`}</p>
          <p className="text-sm text-blue-600">{`Elevation: ${payload[0].value} ft`}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={className}>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Elevation Profile</h3>
        <div className="flex gap-4 text-sm text-gray-600">
          <span>Max Elevation: {Math.max(...chartData.map(d => d.elevation))} ft</span>
          <span>Min Elevation: {Math.min(...chartData.map(d => d.elevation))} ft</span>
          <span>Total Distance: {Math.max(...chartData.map(d => d.distance))} miles</span>
        </div>
      </div>
      
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{
              top: 10,
              right: 30,
              left: 20,
              bottom: 20,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="distance" 
              stroke="#6b7280"
              tick={{ fontSize: 12 }}
              label={{ value: 'Distance (miles)', position: 'insideBottom', offset: -10, style: { textAnchor: 'middle' } }}
            />
            <YAxis 
              stroke="#6b7280"
              tick={{ fontSize: 12 }}
              label={{ value: 'Elevation (ft)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' } }}
            />
            <Tooltip content={customTooltip} />
            <Line 
              type="monotone" 
              dataKey="elevation" 
              stroke="#0f62fe" 
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#0f62fe', strokeWidth: 2, fill: '#fff' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}