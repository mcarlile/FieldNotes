import { Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { ElevationPoint } from '@shared/gpx-utils';

interface ElevationProfileProps {
  elevationProfile: ElevationPoint[];
  onHoverPoint?: (point: ElevationPoint | null) => void;
  className?: string;
}

export default function ElevationProfile({ elevationProfile, onHoverPoint, className }: ElevationProfileProps) {
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

  // Custom tooltip — minimal warm-neutral palette
  const customTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div
          className="meta-mono px-2 py-1.5"
          style={{
            background: 'var(--background)',
            color: 'var(--foreground)',
            border: '1px solid rgba(26, 24, 21, 0.15)',
          }}
        >
          <div>{label} mi</div>
          <div>{payload[0].value} ft</div>
        </div>
      );
    }
    return null;
  };

  // Handle mouse events for immediate, smooth updates
  const handleMouseMove = (data: any) => {
    if (data && data.activePayload && data.activePayload.length && onHoverPoint) {
      const pointIndex = data.activePayload[0].payload.index;
      const point = elevationProfile[pointIndex];
      if (point) {
        // Immediate update for responsive sync
        onHoverPoint(point);
      }
    }
  };

  const handleMouseLeave = () => {
    if (onHoverPoint) {
      // Immediate clear for responsive sync
      onHoverPoint(null);
    }
  };

  return (
    <div className={className}>
      <div className="h-56 sm:h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{
              top: 10,
              right: 16,
              left: 8,
              bottom: 20,
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(26, 24, 21, 0.12)" />
            <XAxis
              dataKey="distance"
              stroke="rgba(26, 24, 21, 0.5)"
              tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
              label={{ value: 'mi', position: 'insideBottomRight', offset: -8, style: { fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fill: 'rgba(26, 24, 21, 0.5)' } }}
            />
            <YAxis
              stroke="rgba(26, 24, 21, 0.5)"
              tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
              label={{ value: 'ft', angle: 0, position: 'insideTopLeft', offset: -4, style: { fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fill: 'rgba(26, 24, 21, 0.5)' } }}
            />
            <Tooltip content={customTooltip} cursor={{ stroke: 'rgba(26, 24, 21, 0.3)', strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="elevation"
              stroke="#1a1815"
              strokeWidth={1.5}
              dot={false}
              activeDot={{
                r: 5,
                stroke: '#1a1815',
                strokeWidth: 2,
                fill: '#f4f1ec',
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}