import { useLocalSearchParams } from 'expo-router';

import { CalendarScreen } from '@/components/calendar/CalendarScreen';

/** Route `habits/{slug}/calendar`: the Calendar View for one habit (android HabitCalendarScreen). */
export default function HabitCalendarRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <CalendarScreen slug={slug ?? ''} />;
}
