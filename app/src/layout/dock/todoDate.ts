export const addDateDays = (dateString: string, days: number) => {
    const date = new Date(`${dateString}T00:00:00`);
    date.setDate(date.getDate() + days);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
};

export const getMondayBasedWeekRange = (dateString: string, weekOffset = 0) => {
    const date = new Date(`${dateString}T00:00:00`);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    const start = addDateDays(dateString, weekOffset * 7 - daysSinceMonday);
    return {
        start,
        end: addDateDays(start, 6),
    };
};

export const getTodoDefaultDue = (filter: string, today: string) => {
    if (filter === "lastWeek") {
        return getMondayBasedWeekRange(today, -1).end;
    }
    return today;
};
