import {
  data as remixData,
  Form,
  NavLink,
  Outlet,
  useLoaderData,
} from 'react-router';
import type {Route} from './+types/account';
import {CUSTOMER_DETAILS_QUERY} from '~/graphql/customer-account/CustomerDetailsQuery';

export function shouldRevalidate() {
  return true;
}

export async function loader({context}: Route.LoaderArgs) {
  const {customerAccount} = context;
  const {data, errors} = await customerAccount.query(CUSTOMER_DETAILS_QUERY, {
    variables: {
      language: customerAccount.i18n.language,
    },
  });

  if (errors?.length || !data?.customer) {
    throw new Error('Customer not found');
  }

  return remixData(
    {customer: data.customer},
    {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    },
  );
}

export default function AccountLayout() {
  const {customer} = useLoaderData<typeof loader>();

  const heading = customer
    ? customer.firstName
      ? `Welcome, ${customer.firstName}`
      : `Welcome to your account.`
    : 'Account Details';

  return (
    <div className="account">
      <h1>{heading}</h1>
      <AccountMenu />
      <Outlet context={{customer}} />
    </div>
  );
}

function AccountMenu() {
  return (
    <nav className="account-nav" role="navigation">
      <NavLink
        to="/account/orders"
        className={({isActive, isPending}) =>
          'account-nav-link' + (isActive ? ' active' : '') + (isPending ? ' pending' : '')
        }
      >
        Orders
      </NavLink>
      <NavLink
        to="/account/profile"
        className={({isActive, isPending}) =>
          'account-nav-link' + (isActive ? ' active' : '') + (isPending ? ' pending' : '')
        }
      >
        Profile
      </NavLink>
      <NavLink
        to="/account/addresses"
        className={({isActive, isPending}) =>
          'account-nav-link' + (isActive ? ' active' : '') + (isPending ? ' pending' : '')
        }
      >
        Addresses
      </NavLink>
      <Logout />
    </nav>
  );
}

function Logout() {
  return (
    <Form className="account-logout" method="POST" action="/account/logout">
      <button type="submit">Sign out</button>
    </Form>
  );
}
